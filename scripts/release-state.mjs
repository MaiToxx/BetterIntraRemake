/**
 * What finish-release.yaml does for a release: the first step of that
 * workflow, every half hour.
 *
 *   GH_TOKEN=... GITHUB_REPOSITORY=owner/name HAS_AMO=true HAS_CRX=true \
 *     node scripts/release-state.mjs [tag]      # default: the latest release
 *
 * Writes tag, version, need_chrome, need_xpi, need_updates_xml and amo_alarm
 * to $GITHUB_OUTPUT (to stdout without it), and a notice for anything it
 * holds back.
 *
 * It holds everything back while a publish.yaml run for the tag is not
 * finished, and while the release is younger than SETTLE_MS. Both workflows
 * used to decide alone: for 1.15.0 this one saw a release without files one
 * minute after it was published, built and attached the Chrome files and
 * pushed updates.xml while publish.yaml was still running the tests those
 * files then failed. The age covers the seconds before GitHub lists the new
 * publish.yaml run. Missing Chrome files are rebuilt for a day at most
 * (CHROME_RETRY_UNTIL_MS), then only on a manual run.
 *
 * Besides a missing file, it repairs an update manifest a failed push left
 * behind (the file is attached first, the manifest pushed after): updates.json
 * through the .xpi path (the signed file is fetched again and re-attached,
 * then the manifest written), updates.xml on its own.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** publish.yaml's own time: the gate, the Chrome files and 20 minutes of AMO signing. */
export const SETTLE_MS = 30 * 60 * 1000;

/**
 * When a version Mozilla never created (validation or upload failure) or
 * refused turns this workflow red, so that GitHub sends an e-mail: from an
 * hour after the release (publish.yaml reports it first) to a day after it.
 * Past that, a notice again: a version that is never coming must not send 48
 * failure e-mails a day. A manual run always reports it.
 */
export const AMO_ALARM_FROM_MS = 60 * 60 * 1000;
export const AMO_ALARM_UNTIL_MS = 24 * 60 * 60 * 1000;

/**
 * How long scheduled runs keep building missing Chrome files. That path runs
 * publish.yaml's whole gate again, so a release whose gate really fails would
 * fail this workflow every half hour until the next release. A day of tries
 * covers a flaky check or a GitHub outage; after that a person decides (a
 * manual run still builds). The .xpi has no such limit: AMO can take days.
 */
export const CHROME_RETRY_UNTIL_MS = 24 * 60 * 60 * 1000;

/** Numeric dotted-version compare: <0 if a < b, 0 if equal, >0 if a > b. */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Every version updates.json lists (scripts/update-updates-json.js writes it). */
export function jsonVersions(text) {
  try {
    const addons = JSON.parse(text)?.addons ?? {};
    return Object.values(addons).flatMap((a) => (a?.updates ?? []).map((u) => u?.version).filter((v) => typeof v === "string"));
  } catch {
    return [];
  }
}

/** The version(s) updates.xml announces (scripts/update-updates-xml.js writes one). */
export function xmlVersions(text) {
  return [...String(text ?? "").matchAll(/<updatecheck\b[^>]*\bversion=['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

const newerThanAll = (version, listed) => listed.every((v) => compareVersions(version, v) > 0);

/**
 * The decision, from what the CLI gathered:
 * - assets: the names of the release's files;
 * - openPublishRuns: publish.yaml runs for the tag that are not completed;
 * - updatesJson / updatesXml: the files on main ("" when not read);
 * - manual: a workflow_dispatch run.
 * Returns { outputs, notices }.
 */
export function releaseState({
  tag,
  assets,
  publishedAt,
  prerelease = false,
  openPublishRuns = 0,
  updatesJson = "",
  updatesXml = "",
  hasAmo,
  hasCrx,
  manual = false,
  now = Date.now(),
}) {
  const version = tag.replace(/^v/, "");
  const outputs = { tag, version, need_chrome: false, need_xpi: false, need_updates_xml: false, amo_alarm: false };
  const notices = [];
  const has = (name) => assets.includes(name);
  if (prerelease) {
    // build-prerelease attaches its own unsigned files; nothing is signed,
    // and a prerelease must never reach updates.json or updates.xml.
    notices.push(`${tag} is a prerelease: nothing to complete.`);
    return { outputs, notices };
  }
  const needChrome = !has("better-intra-chrome.zip");
  let needXpi = hasAmo && !has("better-intra.xpi");
  if (hasAmo && !needXpi && newerThanAll(version, jsonVersions(updatesJson))) {
    notices.push(`${tag} has its .xpi but updates.json on main does not list ${version}: repairing it.`);
    needXpi = true;
  }
  const needXml = hasCrx && !needChrome && has("better-intra.crx") && newerThanAll(version, xmlVersions(updatesXml));
  if (!needChrome && !needXpi && !needXml) return { outputs, notices };

  const age = now - Date.parse(publishedAt);
  if (openPublishRuns > 0) {
    notices.push(`publish.yaml is still running for ${tag}: nothing is done before it ends.`);
    return { outputs, notices };
  }
  if (!(age >= SETTLE_MS)) {
    notices.push(`${tag} was published less than ${SETTLE_MS / 60000} minutes ago: publish.yaml completes it first.`);
    return { outputs, notices };
  }
  outputs.need_chrome = needChrome && (manual || age < CHROME_RETRY_UNTIL_MS);
  if (needChrome && !outputs.need_chrome) {
    notices.push(
      `${tag} still has no Chrome files a day after its release: its release gate probably fails. ` +
        `Publish a fixed release, or run this workflow by hand (gh workflow run finish-release.yaml -f tag=${tag}).`,
    );
  }
  outputs.need_xpi = needXpi;
  outputs.need_updates_xml = needXml;
  outputs.amo_alarm = manual || (age >= AMO_ALARM_FROM_MS && age < AMO_ALARM_UNTIL_MS);
  return { outputs, notices };
}

/** Gathers the facts with the gh CLI (`gh(args)` returns its stdout). */
export function collect({ gh, repo, tag, hasAmo, hasCrx }) {
  const view = JSON.parse(
    gh(["release", "view", ...(tag ? [tag] : []), "--repo", repo, "--json", "tagName,assets,publishedAt,isPrerelease"]),
  );
  const runs = JSON.parse(
    gh(["run", "list", "--repo", repo, "--workflow", "publish.yaml", "--branch", view.tagName, "--json", "status", "--limit", "20"]),
  );
  const assets = (view.assets ?? []).map((a) => a.name);
  const onMain = (file) => {
    try {
      return gh(["api", `repos/${repo}/contents/${file}?ref=main`, "-H", "Accept: application/vnd.github.raw"]);
    } catch (e) {
      if (/HTTP 404/.test(String(e?.stderr ?? e?.message ?? ""))) return "";
      throw e;
    }
  };
  const repairable = !view.isPrerelease;
  return {
    tag: view.tagName,
    assets,
    publishedAt: view.publishedAt,
    prerelease: view.isPrerelease === true,
    // a release event's run carries the tag as its branch
    openPublishRuns: runs.filter((r) => r.status !== "completed").length,
    updatesJson: repairable && hasAmo && assets.includes("better-intra.xpi") ? onMain("updates.json") : "",
    updatesXml: repairable && hasCrx && assets.includes("better-intra.crx") ? onMain("updates.xml") : "",
  };
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error("usage: GH_TOKEN=... GITHUB_REPOSITORY=owner/name node scripts/release-state.mjs [tag]");
    process.exit(2);
  }
  const hasAmo = process.env.HAS_AMO === "true";
  const hasCrx = process.env.HAS_CRX === "true";
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const facts = collect({ gh, repo, tag: process.argv[2] || "", hasAmo, hasCrx });
  const { outputs, notices } = releaseState({
    ...facts,
    hasAmo,
    hasCrx,
    manual: process.env.GITHUB_EVENT_NAME === "workflow_dispatch",
  });
  console.log(`release ${facts.tag} has: ${facts.assets.join(" ") || "(no files)"}`);
  for (const n of notices) console.log(`::notice::${n}`);
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
