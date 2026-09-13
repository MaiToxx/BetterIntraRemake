/**
 * Prepend a release to updates.json (Firefox update manifest).
 *
 *   node scripts/update-updates-json.js 1.8.7
 *
 * The add-on id and download URL are derived from package.json "repository".
 * Firefox only installs updates that are signed (AMO); see README "Updates".
 */
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readRepoInfo } from "./repo-info.js";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: node scripts/update-updates-json.js <x.y.z>");
  process.exit(1);
}

const repo = readRepoInfo();
const file = resolve(dirname(fileURLToPath(import.meta.url)), "../updates.json");

let current = { addons: {} };
try {
  current = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  /* start from scratch */
}

// keep only this fork's entries (drop the upstream id if still present)
const existing = current.addons?.[repo.geckoId]?.updates ?? [];
const updates = [
  { version, update_link: repo.xpiUrl(version) },
  ...existing.filter((u) => u.version !== version),
];

const next = { addons: { [repo.geckoId]: { updates } } };
fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
console.log(`updates.json: ${repo.geckoId} -> v${version} (${updates.length} entries)`);
