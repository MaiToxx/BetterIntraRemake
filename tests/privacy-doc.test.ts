import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readRepoInfo, readWorkerUrl } from "../scripts/repo-info.js";
import { CLOUD_SYNC_KEYS } from "../src/core/config/keys";
import { exportableSettings } from "../src/features/hub/backup";
import { CONFIG_DEFAULT } from "../src/core/config";

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
const src = (file: string) => fs.readFileSync(path.join(ROOT, "src", file), "utf8");

/** The sentence of PRIVACY.md that starts with `start`, up to its full stop. */
function sentence(start: string): string {
  const at = privacy.indexOf(start);
  expect(at, `PRIVACY.md: "${start}"`).toBeGreaterThan(-1);
  return privacy.slice(at, privacy.indexOf(".", at) + 1);
}

/** The line (a list item, a paragraph) of PRIVACY.md that starts with `start`. */
function line(start: string): string {
  const at = privacy.indexOf(start);
  expect(at, `PRIVACY.md: "${start}"`).toBeGreaterThan(-1);
  const end = privacy.indexOf("\n", at);
  return privacy.slice(at, end < 0 ? undefined : end);
}

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

  it("lists the third parties the extension contacts on its own: shortcut icons", () => {
    const shortcuts = src("features/shortcuts/shortcuts.ui.ts");
    if (shortcuts.includes("/favicon.ico")) expect(privacy).toContain("/favicon.ico");
    if (shortcuts.includes("icons.duckduckgo.com")) expect(privacy).toContain("icons.duckduckgo.com");
  });

  it("does not describe the GitHub request the About tab no longer makes", () => {
    expect(src("features/hub/hub.about.ts")).not.toMatch(/fetch\([^)]*api\.github\.com/);
    expect(privacy).not.toMatch(/About tab[^.\n]*api\.github\.com/);
    expect(privacy).not.toMatch(/star and follower counts/);
  });

  it("says the Chrome Web Store build has no update check and no alarms permission", () => {
    expect(privacy).toMatch(/\*\*Update check\*\* \(not in the Chrome Web Store build/);
    expect(privacy).toMatch(/`alarms` — [^\n]*not in the Chrome Web Store build/);
    expect(privacy).toMatch(/`activeTab` \(Firefox only\)/);
  });

  // Each phrase the policy uses for a stored value, and its storage key.
  const PHRASE_KEYS: Array<[RegExp, string]> = [
    [/session token/, "CLOUD_TOKEN"],
    [/(detected campus|campus (the extension|it) detected)/, "CLUSTERS_CAMPUS"],
    [/easter eggs/, "EGGS_FOUND"],
    [/friends' data cache/, "FRIENDS_DATA_CACHE"],
    [/subject tracker's local state/, "SUBJECT_TRACKER_STATE"],
    [/subject tracker choices/, "SUBJECT_TRACKER_SEND_DATA"],
    [/Manual\/Auto push setting/, "CLOUD_SYNC_ENABLED"],
  ];
  const named = (text: string) => PHRASE_KEYS.filter(([re]) => re.test(text)).map(([, key]) => key);

  it("\"Never pushed\" names only keys that are not in CLOUD_SYNC_KEYS, and the pushed list names the ones that are", () => {
    const never = named(sentence("Never pushed:"));
    expect(never).toEqual(expect.arrayContaining(["CLOUD_TOKEN", "EGGS_FOUND", "FRIENDS_DATA_CACHE", "SUBJECT_TRACKER_STATE"]));
    for (const key of never) expect(CLOUD_SYNC_KEYS, key).not.toContain(key);
    // the other direction: a synced key the policy mentions is in the pushed list
    const item = line("- **Your settings**");
    const pushed = item.slice(0, item.indexOf("Never pushed:"));
    for (const key of named(pushed)) expect(CLOUD_SYNC_KEYS, key).toContain(key);
    if (CLOUD_SYNC_KEYS.includes("CLUSTERS_CAMPUS")) expect(named(pushed)).toContain("CLUSTERS_CAMPUS");
    if (CLOUD_SYNC_KEYS.includes("CALENDAR_EVENTS_HASH")) expect(pushed).toMatch(/hash of the last calendar pushed/);
  });

  it("what it says Backup leaves out is left out, and what it says Backup keeps is kept", () => {
    const all = Object.fromEntries(Object.keys(CONFIG_DEFAULT).map((k) => [k, (CONFIG_DEFAULT as Record<string, unknown>)[k]]));
    const exported = Object.keys(exportableSettings(all));
    // "None of these is exported by *Backup* or sent to the cloud."
    const localOnly = privacy.slice(0, privacy.indexOf("None of these is exported by *Backup*"));
    const notExported = named(localOnly.slice(localOnly.lastIndexOf("The extension also keeps")));
    expect(notExported).toContain("CLOUD_TOKEN");
    for (const key of notExported) {
      expect(exported, key).not.toContain(key);
      expect(CLOUD_SYNC_KEYS, key).not.toContain(key);
    }
    const kept = named(sentence("It therefore includes"));
    expect(kept.length).toBeGreaterThan(0);
    for (const key of kept) expect(exported, key).toContain(key);
    for (const key of ["CLOUD_TOKEN", "CALENDAR_SYNC_TOKEN", "FRIENDS_DATA_CACHE"]) expect(exported, key).not.toContain(key);
  });
});

describe("the worker's logging matches the Server logs section", () => {
  const wranglerPath = path.join(ROOT, "../better-intra-worker/wrangler.json");
  // The worker is a sibling repository: present on the maintainer's machine, not in CI.
  it.skipIf(!fs.existsSync(wranglerPath))("does not promise per-request logs the worker has turned off", () => {
    const wrangler = JSON.parse(fs.readFileSync(wranglerPath, "utf8"));
    if (wrangler.observability?.logs?.invocation_logs === false) {
      expect(privacy).not.toMatch(/Every request is logged/);
      expect(privacy).toMatch(/invocation logs off/);
    }
  });
});

describe("CHROME_LISTING.md matches what the code does", () => {
  it("describes the subject tracker, which reports visited project pages when signed in", () => {
    expect(listing).toMatch(/Subject tracker/);
    expect(listing).toMatch(/Share with the community/);
  });

  it("gives the cluster map's real refresh period and no friends timer that does not exist", () => {
    const poll = /POLL_INTERVAL = (\d+)_?(\d*)/.exec(src("features/clusters/map-dialog/context.ts"));
    expect(Number(`${poll![1]}${poll![2]}`)).toBe(60_000);
    expect(listing).toMatch(/refresh every minute/);
    expect(listing).not.toMatch(/every 30 seconds|every 3 minutes/);
  });
});
