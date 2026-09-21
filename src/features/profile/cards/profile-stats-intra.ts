/**
 * Correction statistics and Thursday Roulette history without the 42 API
 * ("intra" auth mode).
 *
 * The upstream worker computes them from api.intra.42.fr with the user's
 * OAuth token. On a self-hosted worker without a 42 application, the same
 * information is available on two Intra v2 pages the user can already open:
 *   https://projects.intra.42.fr/users/{login}/feedbacks?as=corrector
 *     "Feedbacks you made": one li.scaleteam-list-item per evaluation done,
 *     with the scheduled date and the final mark in percent.
 *   https://profile.intra.42.fr/users/{login}/correction_point_historics
 *     .changelog-item entries with the points delta, the running total, the
 *     date and the reason (roulette entries say "Roulette").
 * The pages are fetched by the background script (cross-origin, with the
 * Intra cookies) and parsed here; the result matches the worker's shape.
 */

export interface RouletteEntryLike {
  historic_id: number;
  sum: number;
  total: number;
  created_at: string;
}

export interface EvalStatsLike {
  byMonth: Record<
    string,
    { total: number; failed: number; successPercentage: number | null }
  >;
  global: { total: number; failed: number; successPercentage: number | null };
}

export interface CorrectorFeedback {
  /** "YYYY-MM" of the scheduled date */
  month: string;
  finalMark: number | null;
  positive: boolean;
}

export const FETCH_INTRA_PAGE_MESSAGE = "FT_FETCH_INTRA_PAGE";
const MAX_FEEDBACK_PAGES = 15;

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
  // the profile pages may be localised in French
  janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10,
  décembre: 11, decembre: 11,
};

/**
 * "September 13, 2026 14:30" / "Septembre 13, 2026 19:15" -> "2026-09".
 * The French locale also writes the day first: "13 septembre 2026 14:30".
 */
export function monthKeyFromText(text: string): string | null {
  let monthName: string | undefined;
  let year: string | undefined;
  const en = /([A-Za-zÀ-ÿ]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  if (en) {
    monthName = en[1];
    year = en[3];
  } else {
    const fr = /(?:^|[^\d])(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/.exec(text);
    if (!fr) return null;
    monthName = fr[2];
    year = fr[3];
  }
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function parseCorrectorFeedbacks(html: string): CorrectorFeedback[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: CorrectorFeedback[] = [];
  for (const li of doc.querySelectorAll("li.scaleteam-list-item")) {
    const header = li.querySelector(".header");
    const dateText = header
      ? [...header.querySelectorAll(":scope > b")]
          .map((b) => b.textContent || "")
          .find((t) => /\d{4}/.test(t)) || header.textContent || ""
      : "";
    const month = monthKeyFromText(dateText);
    if (!month) continue;
    const rating = li.querySelector(".final-mark .rating");
    const markMatch = /(\d+)\s*%/.exec(rating?.textContent || "");
    const finalMark = markMatch ? Number(markMatch[1]) : null;
    const positive = rating
      ? rating.hasAttribute("data-positive")
      : finalMark !== null && finalMark >= 50;
    out.push({ month, finalMark, positive });
  }
  return out;
}

/** Same aggregation as the worker: an evaluation is "failed" below 50 %. */
export function computeEvalStats(feedbacks: CorrectorFeedback[]): EvalStatsLike {
  const byMonth: EvalStatsLike["byMonth"] = {};
  let globalTotal = 0;
  let globalFailed = 0;
  for (const f of feedbacks) {
    const failed =
      f.finalMark !== null ? f.finalMark < 50 : !f.positive;
    const entry = (byMonth[f.month] ??= { total: 0, failed: 0, successPercentage: null });
    entry.total += 1;
    if (failed) entry.failed += 1;
    globalTotal += 1;
    if (failed) globalFailed += 1;
  }
  const pct = (total: number, failed: number) =>
    total > 0 ? Math.round(((total - failed) / total) * 1000) / 10 : null;
  for (const m of Object.values(byMonth)) {
    m.successPercentage = pct(m.total, m.failed);
  }
  return {
    byMonth,
    global: {
      total: globalTotal,
      failed: globalFailed,
      successPercentage: pct(globalTotal, globalFailed),
    },
  };
}

/** Next page number from the pagination links, or null on the last page. */
export function nextFeedbackPage(html: string, current: number): number | null {
  const re = /feedbacks\?as=corrector(?:&amp;|&)page=(\d+)/g;
  let max = current;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) max = Math.max(max, Number(m[1]));
  return max > current ? current + 1 : null;
}

export function parseRouletteHistorics(html: string): RouletteEntryLike[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: RouletteEntryLike[] = [];
  const titles = doc.querySelectorAll(".changelog-item p.title");
  titles.forEach((title, index) => {
    const reason = title.querySelector(".reason")?.textContent || "";
    if (!/roulette/i.test(reason)) return;
    const code = title.querySelector("code[data-count][data-date]");
    if (!code) return;
    const sum = Number((code.textContent || "").replace(/\s/g, ""));
    const total = Number(code.getAttribute("data-count"));
    const date = (code.getAttribute("data-date") || "").replace(" UTC", "Z").replace(" ", "T");
    if (!Number.isFinite(sum) || !Number.isFinite(total) || !date) return;
    // stable, distinct ids (the page exposes none); newest first on the page
    out.push({ historic_id: titles.length - index, sum, total, created_at: date });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Local cache of the parsed stats (one hour per login)
// ---------------------------------------------------------------------------

export interface ProfileStatsData {
  roulette: RouletteEntryLike[];
  evalStats: EvalStatsLike | null;
}

export type ProfileStatsCache = Record<string, { at: number; data: ProfileStatsData }>;

/** Single storage key: `{ [login]: { at, data } }`, pruned on every write. */
export const PROFILE_STATS_CACHE_KEY = "FT_PROFILE_STATS_CACHE";
export const PROFILE_STATS_TTL_MS = 60 * 60 * 1000;
export const PROFILE_STATS_CACHE_MAX = 40;
/** Older builds stored one `FT_PROFILE_STATS_<login>` key per visited profile. */
const LEGACY_PROFILE_STATS_PREFIX = "FT_PROFILE_STATS_";

let legacyStatsKeysCleaned = false;

/** Test hook: run the legacy key cleanup again on the next write. */
export function resetProfileStatsCacheState(): void {
  legacyStatsKeysCleaned = false;
}

function isCacheEntry(v: unknown): v is { at: number; data: ProfileStatsData } {
  if (!v || typeof v !== "object") return false;
  const e = v as { at?: unknown; data?: unknown };
  return typeof e.at === "number" && !!e.data && typeof e.data === "object";
}

async function readCacheMap(): Promise<ProfileStatsCache> {
  try {
    const raw = (await chrome.storage.local.get(PROFILE_STATS_CACHE_KEY))[
      PROFILE_STATS_CACHE_KEY
    ];
    if (!raw || typeof raw !== "object") return {};
    const out: ProfileStatsCache = {};
    for (const [login, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (isCacheEntry(entry)) out[login] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

/** Drop expired entries, then keep only the most recent PROFILE_STATS_CACHE_MAX. */
export function pruneProfileStatsCache(
  cache: ProfileStatsCache,
  now: number = Date.now(),
): ProfileStatsCache {
  const fresh = Object.entries(cache).filter(
    ([, e]) => now - e.at < PROFILE_STATS_TTL_MS,
  );
  fresh.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(fresh.slice(0, PROFILE_STATS_CACHE_MAX));
}

export async function readProfileStatsCache(
  login: string,
  now: number = Date.now(),
): Promise<ProfileStatsData | null> {
  const entry = (await readCacheMap())[login];
  if (!entry || now - entry.at >= PROFILE_STATS_TTL_MS) return null;
  return entry.data;
}

export async function writeProfileStatsCache(
  login: string,
  data: ProfileStatsData,
  now: number = Date.now(),
): Promise<void> {
  const cache = await readCacheMap();
  cache[login] = { at: now, data };
  await chrome.storage.local.set({
    [PROFILE_STATS_CACHE_KEY]: pruneProfileStatsCache(cache, now),
  });
  if (!legacyStatsKeysCleaned) {
    legacyStatsKeysCleaned = true;
    await removeLegacyProfileStatsKeys();
  }
}

async function removeLegacyProfileStatsKeys(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const legacy = Object.keys(all).filter(
      (k) =>
        k.startsWith(LEGACY_PROFILE_STATS_PREFIX) && k !== PROFILE_STATS_CACHE_KEY,
    );
    if (legacy.length > 0) await chrome.storage.local.remove(legacy);
  } catch {
    /* best effort */
  }
}

async function fetchIntraPage(url: string): Promise<string | null> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: FETCH_INTRA_PAGE_MESSAGE,
      url,
    })) as { ok: boolean; text?: string } | undefined;
    return res?.ok && typeof res.text === "string" ? res.text : null;
  } catch {
    return null;
  }
}

/**
 * What fetchProfileStatsViaIntra read. `roulette` and `evalStats` keep the
 * worker's shape; the two flags say how much of it can be trusted.
 */
export interface ProfileStatsFetchResult extends ProfileStatsData {
  /**
   * Every page it needed was read. Only a complete result may be cached: a
   * partial one would be shown as the real numbers for PROFILE_STATS_TTL_MS.
   */
  complete: boolean;
  /**
   * The correction-point history was read. When false, `roulette` is empty
   * because it is unknown, not because the student never won.
   */
  rouletteLoaded: boolean;
}

export async function fetchProfileStatsViaIntra(
  login: string,
): Promise<ProfileStatsFetchResult> {
  const safeLogin = encodeURIComponent(login);

  const feedbacks: CorrectorFeedback[] = [];
  let page: number | null = 1;
  let feedbacksComplete = true;
  while (page !== null && page <= MAX_FEEDBACK_PAGES) {
    const html = await fetchIntraPage(
      `https://projects.intra.42.fr/users/${safeLogin}/feedbacks?as=corrector&page=${page}`,
    );
    if (!html) {
      feedbacksComplete = false;
      break;
    }
    feedbacks.push(...parseCorrectorFeedbacks(html));
    page = nextFeedbackPage(html, page);
  }

  const historicsHtml = await fetchIntraPage(
    `https://profile.intra.42.fr/users/${safeLogin}/correction_point_historics`,
  );
  const rouletteLoaded = historicsHtml !== null;
  const roulette = historicsHtml ? parseRouletteHistorics(historicsHtml) : [];

  return {
    roulette,
    // With a page missing (the first or a later one) the totals would be too
    // low and still look real: report no stats rather than wrong ones.
    evalStats: feedbacksComplete ? computeEvalStats(feedbacks) : null,
    complete: feedbacksComplete && rouletteLoaded,
    rouletteLoaded,
  };
}
