/**
 * Single source of truth for "where does this fork live on GitHub".
 * Reads package.json "repository" and derives everything that depends on it:
 * the Firefox add-on id, the Firefox update manifest URL, release links.
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const here = dirname(fileURLToPath(import.meta.url));

/** Upstream cloud worker; override with package.json "config.workerUrl". */
export const DEFAULT_WORKER_URL = "https://api.betterintra.com";

export function readWorkerUrl(pkgPath = resolve(here, "../package.json")) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const raw = pkg.config?.workerUrl || DEFAULT_WORKER_URL;
  const url = new URL(String(raw)); // throws on garbage
  if (url.protocol !== "https:") {
    throw new Error(`package.json config.workerUrl must be https (got ${raw})`);
  }
  return url.origin;
}

export function readRepoInfo(pkgPath = resolve(here, "../package.json")) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const raw =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!raw) throw new Error('package.json: "repository" is missing');
  const m = String(raw)
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (!m) throw new Error(`package.json: unsupported repository URL "${raw}"`);
  const owner = m[1];
  const name = m[2];
  return {
    owner,
    name,
    url: `https://github.com/${owner}/${name}`,
    releasesApi: `https://api.github.com/repos/${owner}/${name}/releases/latest`,
    updatesJsonUrl: `https://raw.githubusercontent.com/${owner}/${name}/main/updates.json`,
    // Chrome self-hosted update manifest (honoured on Linux; Windows/macOS
    // only update extensions from the Chrome Web Store)
    updatesXmlUrl: `https://raw.githubusercontent.com/${owner}/${name}/main/updates.xml`,
    crxUrl: (version) =>
      `https://github.com/${owner}/${name}/releases/download/v${version}/better-intra.crx`,
    // must differ from upstream's id: an AMO-signed id belongs to one account
    geckoId: `better-intra@${owner.toLowerCase()}.github`,
    xpiUrl: (version) =>
      `https://github.com/${owner}/${name}/releases/download/v${version}/better-intra.xpi`,
  };
}
