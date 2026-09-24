/**
 * Friends data without the 42 API ("intra" auth mode).
 *
 * The self-hosted worker has no 42 application, so the friends endpoint that
 * used to aggregate /v2/users and /v2/cursus_users cannot run there. Instead
 * the widget builds the same FriendData shape from the Intra v3 internal API
 * (intrapy), with the session token every Intra page already carries:
 *   GET /api/v1/users/{login}          wallet, evaluation points, location, names
 *   GET /api/v1/users/{login}/summary  profile picture
 *   GET /api/v1/users/{login}/cursus   level and grade (main cursus first)
 * Custom avatars still come from the worker's public visuals endpoint, one
 * batch request for the whole list, cached per login for ten minutes.
 */
import type { FriendData } from "./friends-types.ts";
import { getConfig } from "../../core/config.ts";
import {
  parseIntraDate,
  waitForIntrapyToken,
} from "../../core/intra/intrapy.ts";
import { WORKER_URL } from "../../core/worker.ts";
import { hashLogin } from "../../core/crypto.ts";
import { MAX_REMOTE_URL_LENGTH } from "../../core/security/safe-url.ts";
import { sanitizeCssUrl } from "../../core/security/css-sanitize.ts";
import {
  sanitizeCssColor,
  sanitizeVisualUrls,
} from "../profile/header/visuals-sanitize.ts";
import type { VisualUrls } from "../profile/header/visuals-types.ts";
import {
  getCachedVisualsMany,
  setCachedVisualsMany,
  visualsAreFresh,
} from "../profile/header/visuals-cache.ts";

const INTRAPY = "https://intrapy.intra.42.fr/api/v1";
const LAST_ONLINE_KEY = "FRIENDS_LAST_ONLINE";
const CONCURRENCY = 6;
const AVATAR_BG_KEYWORDS = new Set(["transparent"]);
/**
 * Six intrapy requests share the page's own traffic on cluster Wi-Fi, so the
 * deadline is the one the background already gives Intra pages. Without one,
 * a stalled connection kept the skeleton up for as long as the browser waits.
 */
export const INTRAPY_TIMEOUT_MS = 15_000;
export const VISUALS_TIMEOUT_MS = 8_000;
/** The worker's cap on one `logins=` batch. */
export const VISUALS_BATCH_MAX = 50;

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
/** Another user's string: refused, not truncated, past the shared URL bound. */
const bounded = (v: unknown): unknown =>
  typeof v === "string" && v.length > MAX_REMOTE_URL_LENGTH ? "" : v;

/** Pick the cursus entry to display: main "42cursus" first, then highest level. */
export function pickMainCursus(cursus: unknown): Raw | null {
  if (!Array.isArray(cursus) || cursus.length === 0) return null;
  const entries = cursus.filter((c): c is Raw => !!c && typeof c === "object");
  const main = entries.find((c) => c.slug === "42cursus" || c.kind === "main");
  if (main) return main;
  return entries.reduce<Raw | null>(
    (best, c) => (!best || num(c.level) > num(best.level) ? c : best),
    null,
  );
}

/**
 * The end of a freeze still running, from any cursus entry (a freeze is not
 * always on the main one), the latest if several: what the profile's freeze
 * card reads, so a frozen friend no longer just looks offline.
 */
export function freezeEnd(cursus: unknown, now = Date.now()): string | null {
  if (!Array.isArray(cursus)) return null;
  let best: string | null = null;
  let bestTime = now;
  for (const c of cursus) {
    const until = c && typeof c === "object" ? str((c as Raw).freeze_until) : null;
    if (!until) continue;
    const time = parseIntraDate(until).getTime();
    if (time > bestTime) {
      best = until;
      bestTime = time;
    }
  }
  return best;
}

function poolLabel(user: Raw): string | null {
  const month = str(user.pool_month);
  const year =
    str(user.pool_year) ??
    (typeof user.pool_year === "number" ? String(user.pool_year) : null);
  if (!month || !year) return null;
  const m = new Date(`${month} 1, 2000`).getMonth();
  if (Number.isNaN(m)) return null;
  return `${String(m + 1).padStart(2, "0")}/${year}`;
}

function pictureUrl(picture: string | null): string | null {
  return picture && /^https?:\/\//.test(picture) ? picture : null;
}

/** Whether the /users payload already carries a usable profile picture. */
export function hasProfilePicture(user: Raw | null): boolean {
  return pictureUrl(str(user?.profile_picture)) !== null;
}

/**
 * Apply the worker's public visuals (another user's settings) to a friend.
 * The values end up in an inline style, so anything that is not a plain
 * colour or an http(s) image is dropped, like the
 * profile page does (this widget loads the avatars on every Intra page).
 */
export function applyIntraVisuals(
  friend: FriendData,
  input: Raw | VisualUrls | null,
): FriendData {
  if (!input) return friend;
  const visuals = input as Raw;
  friend.customAvatar = sanitizeCssUrl(bounded(visuals.avatar)) || null;
  friend.avatarBg =
    sanitizeCssColor(bounded(visuals.avatarBg), AVATAR_BG_KEYWORDS) ||
    "transparent";
  friend.avatarPosX = num(visuals.avatarPosX, 50);
  friend.avatarPosY = num(visuals.avatarPosY, 50);
  friend.avatarScale = num(visuals.avatarScale, 100);
  return friend;
}

/** Pure mapping from the three intrapy payloads to the widget's FriendData. */
export function buildFriendFromIntra(
  login: string,
  user: Raw | null,
  summary: Raw | null,
  cursus: unknown,
  lastOnlineTimestamp: number | null,
): FriendData {
  const u = user ?? {};
  const s = summary ?? {};
  const c = pickMainCursus(cursus);
  const location = str(u.location);
  const first = str(u.first_name);
  const last = str(u.last_name);
  const displayName =
    str(u.displayname) ??
    str(u.usual_full_name) ??
    (first || last ? [first, last].filter(Boolean).join(" ") : null) ??
    str(u.displayed_login) ??
    login;
  const picture = str(s.profile_picture) ?? str(u.profile_picture);
  const avatar = pictureUrl(picture);

  return {
    login,
    displayName,
    avatar,
    customAvatar: null,
    avatarBg: "transparent",
    avatarPosX: 50,
    avatarPosY: 50,
    avatarScale: 100,
    level: c ? num(c.level) : 0,
    grade: c ? str(c.grade) : null,
    isOnline: location !== null,
    lastSeen: location,
    poolLabel: poolLabel(u),
    wallet: num(u.wallet),
    correctionPoints: num(u.evaluation_points ?? u.correction_point),
    lastOnlineTimestamp,
    freezeUntil: freezeEnd(cursus),
  };
}

interface JsonReply {
  body: Raw | Raw[] | null;
  /** HTTP status, or 0 when the request itself failed (offline, bad body). */
  status: number;
}

async function getJson(url: string, token: string): Promise<JsonReply> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(INTRAPY_TIMEOUT_MS),
    });
    if (!res.ok) return { body: null, status: res.status };
    return { body: (await res.json()) as Raw | Raw[], status: res.status };
  } catch {
    return { body: null, status: 0 };
  }
}

/**
 * The worker's answer for one login, turned into the stored VisualUrls shape
 * with every string bounded first: the sanitisers accept a URL of any length,
 * and a bloated record would otherwise be cached and styled for every viewer.
 */
function toVisualUrls(data: Raw): VisualUrls {
  const b = (v: unknown, fallback: string) => {
    const x = bounded(v);
    return typeof x === "string" && x ? x : fallback;
  };
  return sanitizeVisualUrls({
    avatar: b(data.avatar, ""),
    banner: b(data.banner, ""),
    bannerMode: b(data.bannerMode, "fill"),
    bannerColor: b(data.bannerColor, ""),
    background: b(data.background, ""),
    backgroundMode: b(data.backgroundMode, "fill"),
    backgroundColor: b(data.backgroundColor, ""),
    avatarBg: b(data.avatarBg, "transparent"),
    decoration: b(data.decoration, "none"),
    avatarPosX: num(data.avatarPosX, 50),
    avatarPosY: num(data.avatarPosY, 50),
    avatarScale: num(data.avatarScale, 100),
    badgeBg: b(data.badgeBg, ""),
    theme: (data.theme as { profileColor?: string }) || null,
    logtime: (data.logtime as Record<string, unknown>) || null,
    look: (data.look as Record<string, unknown>) || null,
    extras: (data.extras as Record<string, unknown>) || null,
  });
}

const isRaw = (v: unknown): v is Raw =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** One `?login=` request: what every worker answers. null when it failed. */
async function fetchVisualsSingle(hashed: string): Promise<Raw | null> {
  try {
    const res = await fetch(
      `${WORKER_URL}/api/v1/public/visuals?login=${encodeURIComponent(hashed)}`,
      { signal: AbortSignal.timeout(VISUALS_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isRaw(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * One `?logins=` request for up to VISUALS_BATCH_MAX hashes. Only the hashes
 * asked for are kept from the answer. undefined when the worker is too old
 * for the route (404), null when the request failed.
 */
async function fetchVisualsBatch(
  hashes: string[],
): Promise<Map<string, Raw | null> | null | undefined> {
  try {
    const res = await fetch(
      `${WORKER_URL}/api/v1/public/visuals?logins=${encodeURIComponent(hashes.join(","))}`,
      { signal: AbortSignal.timeout(VISUALS_TIMEOUT_MS) },
    );
    if (res.status === 404) return undefined;
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const visuals = isRaw(body) && isRaw(body.visuals) ? body.visuals : null;
    if (!visuals) return null;
    const out = new Map<string, Raw | null>();
    for (const h of hashes) {
      const v = visuals[h];
      out.set(h, isRaw(v) ? v : null);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The public visuals of `logins`: from the per-login storage cache when it is
 * less than ten minutes old (a friend without visuals is remembered too), the
 * rest in batches of VISUALS_BATCH_MAX with one worker request each, or one
 * request per login when the worker predates the batch route. Logins the
 * worker could not be asked about are left out, so nothing is cached for them.
 */
export async function fetchFriendsVisuals(
  logins: string[],
): Promise<Map<string, VisualUrls>> {
  const out = new Map<string, VisualUrls>();
  if (logins.length === 0) return out;
  const cached = await getCachedVisualsMany(logins);
  const missing: string[] = [];
  for (const login of logins) {
    const c = cached.get(login);
    if (c && visualsAreFresh(c)) out.set(login, c);
    else missing.push(login);
  }
  if (missing.length === 0) return out;

  const hashes = new Map<string, string>();
  for (const login of missing) hashes.set(await hashLogin(login), login);
  const hashList = [...hashes.keys()];
  const fetched = new Map<string, Raw | null>();
  let batchSupported = true;
  for (
    let i = 0;
    i < hashList.length && batchSupported;
    i += VISUALS_BATCH_MAX
  ) {
    const chunk = hashList.slice(i, i + VISUALS_BATCH_MAX);
    const answer = await fetchVisualsBatch(chunk);
    if (answer === undefined) batchSupported = false;
    else if (answer) for (const [h, v] of answer) fetched.set(h, v);
  }
  if (!batchSupported) {
    const singles = await mapLimit(hashList, CONCURRENCY, fetchVisualsSingle);
    // null is a failed request (the single route answers an empty object
    // for a user without a record): not cached, so it is asked again.
    hashList.forEach((h, i) => {
      if (singles[i]) fetched.set(h, singles[i]);
    });
  }

  const toStore: Record<string, VisualUrls> = {};
  for (const [h, raw] of fetched) {
    const login = hashes.get(h);
    if (!login) continue;
    const urls = toVisualUrls(raw ?? {});
    out.set(login, urls);
    toStore[login] = urls;
  }
  setCachedVisualsMany(toStore);
  return out;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** What intrapy said about a list of logins. */
export interface IntraFriendsResult {
  /** The logins intrapy knows, in the order they were asked for. */
  friends: FriendData[];
  /** Logins /users answered 404 for: the only proof that a login is wrong. */
  notFound: string[];
  /**
   * Logins that could not be checked: no fresh page token, 401 (expired
   * session), 429, 5xx or offline. They may well exist.
   */
  failed: string[];
}

/** How much of a friend to fetch. */
export interface IntraFetchOptions {
  /**
   * "online": only /users (names, location, wallet, points), what the closed
   * widget's badge needs; level, picture and custom avatar are taken from
   * `known` when it has the row. "full": everything (the default).
   */
  detail?: "online" | "full";
  /**
   * Ask the worker for custom avatars. Left out, the setting decides
   * (SHOW_CUSTOM_AVATARS_IN_FRIENDS); off, the worker is never contacted.
   */
  visuals?: boolean;
  /** The last known rows, for the fields an "online" fetch leaves out. */
  known?: FriendData[];
}

/** Carry over what an "online" fetch did not ask for from the last known row. */
function inheritDetails(
  fresh: FriendData,
  old: FriendData | undefined,
): FriendData {
  if (!old) return fresh;
  return {
    ...fresh,
    avatar: fresh.avatar ?? old.avatar,
    level: old.level,
    grade: old.grade,
    freezeUntil: old.freezeUntil ?? null,
    customAvatar: old.customAvatar,
    avatarBg: old.avatarBg,
    avatarPosX: old.avatarPosX,
    avatarPosY: old.avatarPosY,
    avatarScale: old.avatarScale,
  };
}

export async function fetchFriendsIntraResult(
  logins: string[],
  opts: IntraFetchOptions = {},
): Promise<IntraFriendsResult> {
  const full = opts.detail !== "online";
  const token = await waitForIntrapyToken(6000);
  if (!token) return { friends: [], notFound: [], failed: [...logins] };

  let lastOnline: Record<string, number> = {};
  try {
    const store = await chrome.storage.local.get(LAST_ONLINE_KEY);
    lastOnline =
      (store[LAST_ONLINE_KEY] as Record<string, number> | undefined) ?? {};
  } catch {
    // Unreadable "last seen" stamps only lose the relative times for a load.
  }
  const now = Date.now();
  const known = new Map((opts.known ?? []).map((f) => [f.login, f]));
  // One worker request for the whole list, alongside the intrapy calls.
  const wantVisuals =
    opts.visuals ?? !!(await getConfig("SHOW_CUSTOM_AVATARS_IN_FRIENDS"));
  const visualsPromise =
    full && wantVisuals ? fetchFriendsVisuals(logins) : null;

  const results = await mapLimit(logins, CONCURRENCY, async (login) => {
    const base = `${INTRAPY}/users/${encodeURIComponent(login)}`;
    const [userReply, cursusReply] = await Promise.all([
      getJson(base, token),
      full ? getJson(`${base}/cursus`, token) : { body: null, status: 0 },
    ]);
    const user = Array.isArray(userReply.body) ? null : userReply.body;
    // /summary only adds the profile picture: skip it when /users already has
    // one or was not asked for it (it is still consulted for an unknown login,
    // see below), and when /users itself could not be reached, since the
    // retry would fail the same way and double the worst case.
    const wantSummary = user
      ? full && !hasProfilePicture(user)
      : userReply.status !== 0;
    const summaryRaw = wantSummary
      ? (await getJson(`${base}/summary`, token)).body
      : null;
    const summary = Array.isArray(summaryRaw) ? null : summaryRaw;
    if (!user && !summary) {
      // Adding a friend deletes the login on "not-found": only a real 404
      // may say so. An expired session or a rate limit is a failed check.
      return {
        login,
        status: userReply.status === 404 ? "not-found" : "failed",
      } as const;
    }

    const friend = buildFriendFromIntra(
      login,
      user,
      summary,
      cursusReply.body,
      lastOnline[login] ?? null,
    );
    if (friend.isOnline) lastOnline[login] = now;

    return {
      login,
      status: "ok",
      friend: full ? friend : inheritDetails(friend, known.get(login)),
    } as const;
  });

  try {
    await chrome.storage.local.set({ [LAST_ONLINE_KEY]: lastOnline });
  } catch {
    // A lost "last seen" stamp is harmless; failing the whole load is not.
  }
  const visuals = visualsPromise ? await visualsPromise : null;
  const out: IntraFriendsResult = { friends: [], notFound: [], failed: [] };
  for (const r of results) {
    if (r.status === "ok") {
      out.friends.push(
        visuals
          ? applyIntraVisuals(r.friend, visuals.get(r.login) ?? null)
          : r.friend,
      );
    } else if (r.status === "not-found") out.notFound.push(r.login);
    else out.failed.push(r.login);
  }
  return out;
}

/**
 * The friends intrapy knows among `logins`. Unknown logins and logins that
 * could not be checked are both left out: use fetchFriendsIntraResult() to
 * tell them apart.
 */
export async function fetchFriendsDataViaIntra(
  logins: string[],
): Promise<FriendData[]> {
  return (await fetchFriendsIntraResult(logins)).friends;
}
