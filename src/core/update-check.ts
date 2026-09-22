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

/**
 * chrome.storage.local key of the last completed check, whatever its answer
 * (UPDATE_KEY only exists while a newer release is known). It is what lets the
 * background skip a check made less than UPDATE_CHECK_INTERVAL_MS ago, and
 * what carries the ETag GitHub answers 304 to.
 */
export const UPDATE_CHECK_META_KEY = "UPDATE_CHECK_META";

export interface UpdateCheckMeta {
  checkedAt: number;
  etag?: string;
}

/**
 * One request to GitHub per this interval, per browser. A 42 campus sits
 * behind one address and the unauthenticated API allows 60 requests an hour
 * for all of it; the popup and the hub read the stored result instead.
 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** True when the last completed check is recent enough to stand. */
export function isUpdateCheckFresh(
  meta: unknown,
  now: number = Date.now(),
): boolean {
  if (!meta || typeof meta !== "object") return false;
  const at = (meta as { checkedAt?: unknown }).checkedAt;
  // a clock set back must not silence the check for years
  return typeof at === "number" && now - at >= 0 && now - at < UPDATE_CHECK_INTERVAL_MS;
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
  const rel = json as {
    tag_name?: unknown;
    html_url?: unknown;
    draft?: unknown;
    assets?: unknown;
  };
  if (rel.draft === true) return null;
  if (typeof rel.tag_name !== "string") return null;
  // A release whose build is still being signed/attached has no files yet:
  // do not send users to an empty page.
  if (Array.isArray(rel.assets)) {
    const names = rel.assets
      .map((a) => (a && typeof a === "object" ? (a as { name?: unknown }).name : null))
      .filter((n): n is string => typeof n === "string");
    if (!names.some((n) => /^better-intra.*\.(zip|xpi|crx)$/.test(n))) return null;
  }
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
