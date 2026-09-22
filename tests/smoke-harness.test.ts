import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { harnessHosts } from "../scripts/firefox-smoke/server.mjs";
import { finalizeManifest } from "../vite.config.ts";
import { readWorkerUrl } from "../scripts/repo-info.js";

const ROOT = path.resolve(__dirname, "..");
const WORKER = "https://worker.example.workers.dev";

describe("smoke harness hosts", () => {
  it("serves api.github.com although no manifest asks for it", () => {
    // The update check and the About tab reach GitHub as CORS requests; the
    // harness must still intercept them, or they leave the machine.
    const { hosts } = harnessHosts({ host_permissions: ["https://*.intra.42.fr/*"] }, WORKER);
    expect(hosts).toContain("api.github.com");
  });

  it("takes the worker from package.json as well as from the manifest", () => {
    const fromConfig = harnessHosts({ host_permissions: ["https://*.intra.42.fr/*"] }, WORKER);
    expect(fromConfig.workerHosts).toEqual(["worker.example.workers.dev"]);
    const fromManifest = harnessHosts({ host_permissions: ["https://api.betterintra.com/*"] }, null);
    expect(fromManifest.workerHosts).toEqual(["api.betterintra.com"]);
    const both = harnessHosts({ host_permissions: ["https://api.betterintra.com/*"] }, WORKER);
    expect(both.workerHosts.sort()).toEqual(["api.betterintra.com", "worker.example.workers.dev"]);
    expect(both.hosts).not.toContainEqual(expect.stringContaining("*"));
  });

  it("covers every host the shipped manifests can reach", () => {
    for (const target of ["chrome", "firefox"] as const) {
      const template = JSON.parse(
        fs.readFileSync(path.join(ROOT, `manifests/manifest.${target}.json`), "utf8"),
      );
      const manifest = finalizeManifest(template, {
        target,
        authMode: "intra",
        workerUrl: readWorkerUrl(),
        version: "0.0.0",
        repo: { geckoId: "x@y", updatesJsonUrl: "https://x/u.json", updatesXmlUrl: "https://x/u.xml" },
        chromeStore: false,
      });
      const { hosts } = harnessHosts(manifest, readWorkerUrl());
      for (const p of manifest.host_permissions ?? []) {
        const host = new URL(p.replace("*.", "")).hostname;
        if (host.endsWith("intra.42.fr")) continue; // the wildcard: INTRA_HOSTS
        expect(hosts).toContain(host);
      }
    }
  });
});
