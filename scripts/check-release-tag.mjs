/**
 * Fails unless a release tag names the version package.json holds.
 *
 *   node scripts/check-release-tag.mjs v1.16.1                  # before `gh release create`
 *   node scripts/check-release-tag.mjs v1.17.0-rc1 --prerelease # a suffix is allowed
 *
 * Reads package.json from the current folder (finish-release.yaml runs main's
 * copy of this script inside its checkout of the tag).
 *
 * Why: the version comes from two places. Every built manifest takes
 * package.json's (vite.config.ts), while updates.json, updates.xml, the AMO
 * lookups and the in-extension update check take the tag. A forgotten bump
 * attaches 1.16.0 packages to v1.16.1 and announces 1.16.1: the .crx
 * updater rejects the package, the NEW badge never clears after installing
 * the zip, and AMO refuses a second 1.16.0 in a run that still ends green.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when `tag` is `v<version>`. A prerelease may add a suffix
 * (v1.17.0-rc1): a manifest version cannot carry "-rc1", so it can never
 * equal package.json's.
 */
export function tagMatchesVersion(tag, version, { prerelease = false } = {}) {
  if (typeof tag !== "string" || typeof version !== "string" || !version) return false;
  if (tag === `v${version}`) return true;
  return prerelease && tag.startsWith(`v${version}-`) && tag.length > version.length + 2;
}

function main() {
  const args = process.argv.slice(2);
  const prerelease = args.includes("--prerelease");
  const tag = args.find((a) => !a.startsWith("--"));
  if (!tag) {
    console.error("usage: node scripts/check-release-tag.mjs <tag> [--prerelease]");
    process.exit(2);
  }
  const { version } = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
  if (!tagMatchesVersion(tag, version, { prerelease })) {
    console.log(`::error::release tag ${tag} but package.json says ${version}: bump package.json or fix the tag`);
    process.exit(1);
  }
  console.log(`release tag ${tag} matches package.json ${version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
