/**
 * Update check against the GitHub Releases of this repository.
 *
 * Chrome cannot auto-update an extension loaded unpacked, and Firefox only
 * auto-installs signed builds, so the extension itself checks the latest
 * release and tells the user (badge on the toolbar icon + banner in the popup).
 */

/** chrome.storage.local key (not a setting: never exported in backups). */
export const UPDATE_KEY = "UPDATE_AVAILABLE";

export interface UpdateInfo {
  version: string;
  url: string;
  checkedAt: number;
}

/** Numeric dotted-version compare: <0 if a < b, 0 if equal, >0 if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Extract {version, url} from a GitHub "releases/latest" payload, or null. */
export function parseLatestRelease(
  json: unknown,
): { version: string; url: string } | null {
  if (!json || typeof json !== "object") return null;
  const rel = json as { tag_name?: unknown; html_url?: unknown; draft?: unknown };
  if (rel.draft === true) return null;
  if (typeof rel.tag_name !== "string") return null;
  const version = rel.tag_name.replace(/^v/i, "");
  if (!/^\d+(\.\d+)*$/.test(version)) return null;
  const url =
    typeof rel.html_url === "string" && /^https:\/\/github\.com\//.test(rel.html_url)
      ? rel.html_url
      : "";
  if (!url) return null;
  return { version, url };
}

/** True when `latest` is strictly newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
