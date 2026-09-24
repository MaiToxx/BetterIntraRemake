/**
 * Writes a release into updates.json or updates.xml on main and pushes it,
 * trying again when main moved in between.
 *
 *   node scripts/push-update-manifest.mjs updates.json v1.16.1
 *   node scripts/push-update-manifest.mjs updates.xml v1.16.1
 *
 * Each try: fetch main, check it out (detached, over whatever the job had
 * checked out, the release tag in publish.yaml), run main's
 * update-updates-json.js or update-updates-xml.js, commit as
 * github-actions[bot] and push to main. Nothing to commit means main already
 * has it.
 *
 * Why: publish.yaml and finish-release.yaml both write these files, each
 * right after attaching a file to the release. A push rejected because main
 * moved between the fetch and the push failed the job with the file already
 * attached, and nothing repaired it: a rerun of publish.yaml resubmits a
 * version AMO already has, web-ext sign fails, and every step after it is
 * skipped. finish-release.yaml (scripts/release-state.mjs) now also repairs a
 * manifest left behind, and this retry covers the likeliest cause.
 *
 * updates.xml holds one version and never moves backwards: completing an
 * older release (gh workflow run finish-release.yaml -f tag=...) must not
 * announce it over a newer one to the Linux .crx installs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareVersions, xmlVersions } from "./release-state.mjs";

const SCRIPTS = {
  "updates.json": "scripts/update-updates-json.js",
  "updates.xml": "scripts/update-updates-xml.js",
};

const BOT = ["-c", "user.name=github-actions[bot]", "-c", "user.email=github-actions[bot]@users.noreply.github.com"];

/**
 * `run(cmd, args)` returns { status, stdout, stderr } (injectable for tests),
 * `readFile` reads a file of the checkout. Resolves to "pushed" or
 * "unchanged"; throws when a git step fails or every push was rejected.
 */
export async function pushUpdateManifest({
  file,
  version,
  run,
  readFile = (f) => fs.readFileSync(f, "utf8"),
  tries = 3,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
}) {
  const script = SCRIPTS[file];
  if (!script) throw new Error(`unknown update manifest ${file}`);
  const must = (cmd, args) => {
    const r = run(cmd, args);
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${String(r.stderr ?? "").trim()}`);
    return r;
  };
  for (let attempt = 1; attempt <= tries; attempt++) {
    must("git", ["fetch", "origin", "main"]);
    must("git", ["checkout", "--force", "--detach", "FETCH_HEAD"]);
    if (file === "updates.xml") {
      const announced = xmlVersions(readFile(file));
      const newest = announced.sort(compareVersions).at(-1);
      if (newest && compareVersions(newest, version) >= 0) {
        log(`updates.xml already announces ${newest}: left as it is`);
        return "unchanged";
      }
    }
    must(process.execPath, [script, version]);
    must("git", ["add", file]);
    if (run("git", ["diff", "--cached", "--quiet"]).status === 0) {
      log(`${file} on main already lists ${version}`);
      return "unchanged";
    }
    must("git", [...BOT, "commit", "-m", `chore: update ${file} for v${version}`]);
    if (run("git", ["push", "origin", "HEAD:main"]).status === 0) {
      log(`${file}: v${version} pushed to main`);
      return "pushed";
    }
    if (attempt < tries) {
      log(`push of ${file} rejected (try ${attempt} of ${tries}), main probably moved: trying again`);
      await wait(5000 * attempt);
    }
  }
  throw new Error(`could not push ${file} for v${version} after ${tries} tries`);
}

async function main() {
  const [file, tag] = process.argv.slice(2);
  const version = tag?.replace(/^v/, "");
  if (!SCRIPTS[file] || !version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("usage: node scripts/push-update-manifest.mjs <updates.json|updates.xml> <vX.Y.Z>");
    process.exit(2);
  }
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });
    if (r.stderr) process.stderr.write(r.stderr);
    return { status: r.status ?? 1, stderr: r.stderr };
  };
  await pushUpdateManifest({ file, version, run });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`::error::${String(e?.message ?? e)}`);
    process.exit(1);
  });
}
