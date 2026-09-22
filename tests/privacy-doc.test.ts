import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readRepoInfo, readWorkerUrl } from "../scripts/repo-info.js";
import { CLOUD_SYNC_KEYS } from "../src/core/config/keys";

/**
 * PRIVACY.md is what a student or a store reviewer reads before installing.
 * It drifted once into describing the upstream product; these checks tie it
 * to the manifests, package.json and the sync key list so it cannot again.
 */
const ROOT = path.resolve(__dirname, "..");
const privacy = fs.readFileSync(path.join(ROOT, "PRIVACY.md"), "utf8");
const listing = fs.readFileSync(path.join(ROOT, "CHROME_LISTING.md"), "utf8");
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const repo = readRepoInfo();
const workerHost = new URL(readWorkerUrl()).host;

const manifests = (["chrome", "firefox"] as const).map((t) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, `manifests/manifest.${t}.json`), "utf8")),
);

describe("PRIVACY.md matches the build", () => {
  it("names every permission and every host permission of the manifests", () => {
    for (const m of manifests) {
      for (const p of m.permissions as string[]) expect(privacy).toContain(`\`${p}\``);
      for (const origin of m.host_permissions as string[]) {
        // The upstream worker origin is swapped for the fork's at build time.
        const host = origin.includes("api.betterintra.com") ? workerHost : new URL(origin.replace("*.", "")).host;
        expect(privacy).toContain(host);
      }
    }
  });

  it("mentions no host permission the manifests do not ask for", () => {
    const permitted = manifests.flatMap((m) => m.host_permissions as string[]);
    expect(permitted.some((p) => p.includes("github.com"))).toBe(false);
    expect(privacy).toMatch(/No permission is requested for `api\.github\.com`/);
  });

  it("describes the Intra-token sign-in, not the upstream OAuth and Discord flows", () => {
    expect(privacy).toContain("/auth/intra");
    expect(privacy).toMatch(/JWKS/);
    expect(privacy).not.toMatch(/Discord User ID|Evaluations Background Service|OAuth Authentication/);
  });

  it("says that the friends list and the calendar token travel with pushed settings", () => {
    expect(CLOUD_SYNC_KEYS).toContain("FRIENDS_LIST");
    expect(CLOUD_SYNC_KEYS).toContain("CALENDAR_SYNC_TOKEN");
    expect(privacy).toMatch(/\*\*friends list\*\*/);
    expect(privacy).toMatch(/\*\*calendar subscription token\*\*/);
  });

  it("points at this fork, and so do the listing and the README", () => {
    expect(privacy).toContain(`${repo.url}/issues`);
    expect(privacy).not.toContain("nicopasla/better-intra/issues");
    expect(listing).toContain(`${repo.url}/blob/main/PRIVACY.md`);
    // Upstream features this build does not ship (README, "Not available").
    expect(listing).not.toMatch(/Discord DM|Le Bassin|Belgium|Students directory|Outstanding/);
    expect(readme).not.toContain("Nothing leaves the browser until you connect");
  });
});
