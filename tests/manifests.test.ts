import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalizeManifest, copyLicenseFiles, LICENSE_FILES, type ManifestBuild } from "../vite.config.ts";
import { DEFAULT_WORKER_URL } from "../scripts/repo-info.js";

const ROOT = path.resolve(__dirname, "..");
const read = (target: "chrome" | "firefox") =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `manifests/manifest.${target}.json`), "utf8"));

const build = (over: Partial<ManifestBuild>): ManifestBuild => ({
  target: "chrome",
  authMode: "intra",
  workerUrl: "https://worker.example.workers.dev",
  version: "9.9.9",
  repo: {
    geckoId: "better-intra@test.github",
    updatesJsonUrl: "https://example.test/updates.json",
    updatesXmlUrl: "https://example.test/updates.xml",
  },
  chromeStore: false,
  ...over,
});

describe("manifest templates", () => {
  for (const target of ["chrome", "firefox"] as const) {
    it(`${target}: asks no host permission for api.github.com`, () => {
      // The release check (background) and the About tab fetch GitHub as
      // plain CORS requests: api.github.com answers Access-Control-Allow-Origin
      // "*", so the permission only lengthened the install prompt.
      const hosts: string[] = read(target).host_permissions;
      expect(hosts.some((h) => h.includes("github.com"))).toBe(false);
      expect(hosts).toContain("https://*.intra.42.fr/*");
      expect(hosts).toContain(`${DEFAULT_WORKER_URL}/*`);
    });
  }

  it("both browsers ask the same permissions, except activeTab (Firefox only)", () => {
    // Chrome grants host permissions at install: the popup reads the Intra
    // tab's URL through the *.intra.42.fr one, tabs.sendMessage/reload/create
    // need no permission, and nothing calls chrome.scripting. The store
    // reviews an unused permission as an excessive one. Firefox keeps it:
    // there the host permission can be refused, and activeTab is what lets
    // the popup see it is on an Intra tab and show the account panel.
    expect(read("chrome").permissions).not.toContain("activeTab");
    expect(read("firefox").permissions).toContain("activeTab");
    expect(read("chrome").permissions).toEqual(
      read("firefox").permissions.filter((p: string) => p !== "activeTab"),
    );
    expect(read("chrome").host_permissions).toEqual(read("firefox").host_permissions);
  });

  it("chrome: refuses to install below the first version that honours a MAIN-world content script", () => {
    const manifest = read("chrome");
    const hook = manifest.content_scripts.find((cs: { js: string[] }) => cs.js.includes("hook.js"));
    expect(hook.world).toBe("MAIN");
    expect(manifest.minimum_chrome_version).toBe("111");
  });
});

describe("finalizeManifest", () => {
  for (const target of ["chrome", "firefox"] as const) {
    it(`${target}, intra mode: no content script on the worker's OAuth callback page`, () => {
      const out = finalizeManifest(read(target), build({ target }));
      const files = out.content_scripts!.flatMap((cs) => cs.js ?? []);
      expect(files).toEqual(["hook.js", "content.js"]);
      expect(out.content_scripts!.flatMap((cs) => cs.matches ?? [])).not.toContainEqual(
        expect.stringContaining("/callback"),
      );
    });
  }

  it("intra mode keeps the worker origin: the popup and the login button request it with chrome.permissions", () => {
    const out = finalizeManifest(read("firefox"), build({ target: "firefox" }));
    expect(out.host_permissions).toEqual([
      "https://worker.example.workers.dev/*",
      "https://*.intra.42.fr/*",
    ]);
  });

  it("oauth mode keeps the callback script, on the configured worker", () => {
    const out = finalizeManifest(read("chrome"), build({ authMode: "oauth" }));
    const cb = out.content_scripts!.find((cs) => cs.js?.includes("auth-callback.js"));
    expect(cb?.matches).toEqual(["https://worker.example.workers.dev/callback*"]);
  });

  it("does not modify the template it was given", () => {
    const template = read("chrome");
    const before = JSON.stringify(template);
    finalizeManifest(template, build({}));
    expect(JSON.stringify(template)).toBe(before);
  });

  it("firefox gets the fork's id and update manifest, chrome the .crx update url unless it is the store build", () => {
    const ff = finalizeManifest(read("firefox"), build({ target: "firefox" }));
    expect(ff.browser_specific_settings?.gecko).toMatchObject({
      id: "better-intra@test.github",
      update_url: "https://example.test/updates.json",
    });
    expect(finalizeManifest(read("chrome"), build({})).update_url).toBe("https://example.test/updates.xml");
    expect(finalizeManifest(read("chrome"), build({ chromeStore: true })).update_url).toBeUndefined();
  });

  it("the store build asks no alarms permission: its only user, the release check, is not compiled in", () => {
    const store = finalizeManifest(read("chrome"), build({ chromeStore: true }));
    expect(store.permissions).toEqual(["storage"]);
    expect(finalizeManifest(read("chrome"), build({})).permissions).toContain("alarms");
    expect(finalizeManifest(read("firefox"), build({ target: "firefox" })).permissions).toContain("alarms");
  });
});

describe("licence files", () => {
  it("every build copies LICENSE and the third-party notices next to manifest.json", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bi-licences-"));
    try {
      expect(copyLicenseFiles(ROOT, out)).toEqual([...LICENSE_FILES]);
      expect(fs.readFileSync(path.join(out, "LICENSE"), "utf8")).toContain("Copyright (c) 2026 nicopasla");
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("the notices name every bundled library and asset whose licence asks for it", () => {
    const notices = fs.readFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES.txt"), "utf8");
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    // Runtime dependencies end up in content.js/popup.js; @tailwindcss/vite
    // is the build plugin, the stylesheet it compiles is Tailwind's.
    const bundled = Object.keys(pkg.dependencies).map((d) => (d === "@tailwindcss/vite" ? "tailwindcss" : d));
    for (const dep of [...bundled, "daisyui"]) expect(notices).toContain(dep);
    expect(notices).toContain("Copyright (c) 2022 Freek Bes"); // theme-dark-v2.css
    expect(notices).toContain("Copyright (c) 2017 Google LLC"); // lit-html, BSD-3-Clause
    expect(notices).toContain("Copyright (c) 2009 Kazuhiko Arase"); // qrcode-generator
    expect(notices).toContain("Lucide");
    expect(notices).toContain("Font Awesome");
  });
});
