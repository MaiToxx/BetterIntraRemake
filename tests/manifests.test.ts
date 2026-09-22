import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { finalizeManifest, type ManifestBuild } from "../vite.config.ts";
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

  it("both browsers ask the same permissions", () => {
    expect(read("chrome").permissions).toEqual(read("firefox").permissions);
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
});
