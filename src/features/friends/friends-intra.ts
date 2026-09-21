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
 * Custom avatars still come from the worker's public visuals endpoint.
 */
import type { FriendData } from "./friends-types.ts";
import { waitForIntrapyToken } from "../../core/intra/intrapy.ts";
import { WORKER_URL } from "../../core/worker.ts";
import { hashLogin } from "../../core/crypto.ts";
import {
  sanitizeCssColor,
  sanitizeCssUrl,
} from "../profile/header/visuals-sanitize.ts";

const INTRAPY = "https://intrapy.intra.42.fr/api/v1";
const LAST_ONLINE_KEY = "FRIENDS_LAST_ONLINE";
const CONCURRENCY = 6;
const AVATAR_BG_KEYWORDS = new Set(["transparent"]);

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

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

function poolLabel(user: Raw): string | null {
  const month = str(user.pool_month);
  const year = str(user.pool_year) ?? (typeof user.pool_year === "number" ? String(user.pool_year) : null);
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
 * http(s) URL or a plain colour is dropped, like the profile page does.
 */
export function applyIntraVisuals(friend: FriendData, visuals: Raw | null): FriendData {
  if (!visuals) return friend;
  friend.customAvatar = sanitizeCssUrl(visuals.avatar) || null;
  friend.avatarBg =
    sanitizeCssColor(visuals.avatarBg, AVATAR_BG_KEYWORDS) || "transparent";
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
  };
}

interface JsonReply {
  body: Raw | Raw[] | null;
  /** HTTP status, or 0 when the request itself failed (offline, bad body). */
  status: number;
}

async function getJson(url: string, token: string): Promise<JsonReply> {
  try {
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) return { body: null, status: res.status };
    return { body: (await res.json()) as Raw | Raw[], status: res.status };
  } catch {
    return { body: null, status: 0 };
  }
}

async function fetchVisuals(login: string): Promise<Raw | null> {
  try {
    const hashed = await hashLogin(login);
    const res = await fetch(
      `${WORKER_URL}/api/v1/public/visuals?login=${encodeURIComponent(hashed)}`,
    );
    return res.ok ? ((await res.json()) as Raw) : null;
  } catch {
    return null;
  }
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

export async function fetchFriendsIntraResult(
  logins: string[],
): Promise<IntraFriendsResult> {
  const token = await waitForIntrapyToken(6000);
  if (!token) return { friends: [], notFound: [], failed: [...logins] };

  const store = await chrome.storage.local.get(LAST_ONLINE_KEY);
  const lastOnline: Record<string, number> =
    (store[LAST_ONLINE_KEY] as Record<string, number> | undefined) ?? {};
  const now = Date.now();

  const results = await mapLimit(logins, CONCURRENCY, async (login) => {
    const base = `${INTRAPY}/users/${encodeURIComponent(login)}`;
    const [userReply, cursusReply, visuals] = await Promise.all([
      getJson(base, token),
      getJson(`${base}/cursus`, token),
      fetchVisuals(login),
    ]);
    const user = Array.isArray(userReply.body) ? null : userReply.body;
    // /summary only adds the profile picture: skip it when /users already has
    // one (it is still consulted for an unknown login, see below)
    const summaryRaw = hasProfilePicture(user)
      ? null
      : (await getJson(`${base}/summary`, token)).body;
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

    return { login, status: "ok", friend: applyIntraVisuals(friend, visuals) } as const;
  });

  await chrome.storage.local.set({ [LAST_ONLINE_KEY]: lastOnline });
  const out: IntraFriendsResult = { friends: [], notFound: [], failed: [] };
  for (const r of results) {
    if (r.status === "ok") out.friends.push(r.friend);
    else if (r.status === "not-found") out.notFound.push(r.login);
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
