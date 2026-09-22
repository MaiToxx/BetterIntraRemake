import { SeatPos } from "./crop";

const SVG_CACHE_PREFIX = "cluster_svg_";
const SVG_URLS_CACHE_PREFIX = "CLUSTER_SVG_URLS_V1_";
const META_BASE = "https://meta.intra.42.fr/";
const CACHE_TTL = 7 * 24 * 60 * 60_000;

export interface CachedCluster {
  svg: string;
  seats: [string, SeatPos][];
  viewBox: { w: number; h: number };
  cachedAt: number;
}

interface SvgsCacheEntry {
  data: Record<string, string>;
  cachedAt: number;
}

/**
 * The cached map of one cluster, or null when there is none or it is older
 * than 7 days. `allowStale` also returns an expired entry: for when the
 * worker's /cluster/svg fetch failed, since last week's map beats an empty
 * pane (only a fallback: a fresh fetch must stay the first choice).
 */
export async function getCachedCluster(
  campusId: string,
  clusterId: string,
  opts: { allowStale?: boolean } = {},
): Promise<CachedCluster | null> {
  const key = `${SVG_CACHE_PREFIX}${campusId}_${clusterId}`;
  const result = (await chrome.storage.local.get(key)) as Record<string, string>;
  const raw = result[key];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedCluster;
    if (!opts.allowStale && Date.now() - parsed.cachedAt > CACHE_TTL) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * How many cluster maps stay in chrome.storage.local. A map is a few hundred
 * KB of SVG and Chrome caps storage.local at 10 MB for the whole extension
 * (settings and friends included): once full, every later set() fails. Twelve
 * maps cover a campus with a couple of neighbours in roughly 3-4 MB.
 */
export const SVG_CACHE_MAX_ENTRIES = 12;

/**
 * Keep the SVG cache bounded. The campus being written is never evicted, so
 * its expired maps still serve as the stale fallback when the worker fails;
 * other campuses lose their expired maps first, then the oldest ones beyond
 * the cap. Failures are ignored: a sweep that cannot run must not stop a map
 * from being shown.
 */
async function sweepSvgCache(keepCampusId: string): Promise<void> {
  const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const now = Date.now();
  const entries: { key: string; cachedAt: number; own: boolean }[] = [];
  for (const [key, raw] of Object.entries(all)) {
    if (!key.startsWith(SVG_CACHE_PREFIX)) continue;
    const own = key.startsWith(`${SVG_CACHE_PREFIX}${keepCampusId}_`);
    let cachedAt = 0;
    try {
      cachedAt = Number((JSON.parse(String(raw)) as CachedCluster).cachedAt) || 0;
    } catch {}
    entries.push({ key, cachedAt, own });
  }
  const remove = new Set<string>();
  for (const e of entries) {
    if (!e.own && now - e.cachedAt > CACHE_TTL) remove.add(e.key);
  }
  const kept = entries
    .filter((e) => !remove.has(e.key))
    .sort((a, b) => b.cachedAt - a.cachedAt);
  let count = 0;
  for (const e of kept) {
    if (e.own || count < SVG_CACHE_MAX_ENTRIES) {
      count++;
      continue;
    }
    remove.add(e.key);
  }
  if (remove.size > 0) await chrome.storage.local.remove([...remove]);
}

export async function setCachedCluster(
  campusId: string,
  clusterId: string,
  data: CachedCluster,
) {
  data.cachedAt = Date.now();
  await chrome.storage.local.set({
    [`${SVG_CACHE_PREFIX}${campusId}_${clusterId}`]: JSON.stringify(data),
  });
  try {
    await sweepSvgCache(campusId);
  } catch {}
}

export function getSvgSlug(svgUrl: string): string {
  try {
    const path = new URL(svgUrl).pathname;
    const file = path.split("/").pop() || "";
    return file.replace(/\.svg$/i, "");
  } catch {
    return "";
  }
}

export function parseClusterPanes(html: string): Record<string, string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const map: Record<string, string> = {};
  for (const pane of doc.querySelectorAll(".tab-pane")) {
    const id = pane.getAttribute("id") || "";
    const match = id.match(/^cluster-(.+)$/);
    if (!match) continue;
    const svgUrl = pane
      .querySelector(".map-container[data-image]")
      ?.getAttribute("data-image");
    if (!svgUrl) continue;
    try {
      map[match[1]] = new URL(svgUrl, META_BASE).href;
    } catch {}
  }
  return map;
}

export async function scrapeCampusSVGUrls(
  campusId: string,
): Promise<Record<string, string>> {
  const cacheKey = `${SVG_URLS_CACHE_PREFIX}${campusId}`;
  const cached = (await chrome.storage.local.get(cacheKey)) as {
    [cacheKey]?: SvgsCacheEntry;
  };
  const entry = cached[cacheKey];
  if (entry && Date.now() - entry.cachedAt <= CACHE_TTL) {
    return entry.data;
  }
  try {
    const url = campusId
      ? `https://meta.intra.42.fr/campus/${campusId}/clusters`
      : "https://meta.intra.42.fr/clusters";
    const res = await fetch(url, {
      headers: { Accept: "text/html" },
      credentials: "include",
    });
    if (res.ok) {
      const html = await res.text();
      const data = parseClusterPanes(html);
      if (Object.keys(data).length > 0) {
        chrome.storage.local.set({
          [cacheKey]: { data, cachedAt: Date.now() },
        });
        return data;
      }
    }
  } catch {
  }
  // meta.intra.42.fr unreachable, signed out or changed: last known URLs
  // (they rarely change) rather than a map dialog with no clusters at all.
  return entry?.data ?? {};
}
