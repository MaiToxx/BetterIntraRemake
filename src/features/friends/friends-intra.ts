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
import type { FriendData } from "./friends.ts";
import { waitForIntrapyToken } from "../../utils/intrapy.ts";
import { WORKER_URL } from "../../utils/worker.ts";
import { hashLogin } from "../../utils/crypto.ts";
import {
  sanitizeCssColor,
  sanitizeCssUrl,
} from "../profile/visuals-sanitize.ts";

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

async function getJson(url: string, token: string): Promise<Raw | Raw[] | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) return null;
    return (await res.json()) as Raw | Raw[];
  } catch {
    return null;
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

export async function fetchFriendsDataViaIntra(
  logins: string[],
): Promise<FriendData[]> {
  const token = await waitForIntrapyToken(6000);
  if (!token) return [];

  const store = await chrome.storage.local.get(LAST_ONLINE_KEY);
  const lastOnline: Record<string, number> =
    (store[LAST_ONLINE_KEY] as Record<string, number> | undefined) ?? {};
  const now = Date.now();

  const results = await mapLimit(logins, CONCURRENCY, async (login) => {
    const base = `${INTRAPY}/users/${encodeURIComponent(login)}`;
    const [userRaw, cursus, visuals] = await Promise.all([
      getJson(base, token),
      getJson(`${base}/cursus`, token),
      fetchVisuals(login),
    ]);
    const user = Array.isArray(userRaw) ? null : userRaw;
    // /summary only adds the profile picture: skip it when /users already has
    // one (it is still consulted for an unknown login, see below)
    const summaryRaw = hasProfilePicture(user)
      ? null
      : await getJson(`${base}/summary`, token);
    const summary = Array.isArray(summaryRaw) ? null : summaryRaw;
    // unknown login (add-friend validation relies on an empty result)
    if (!user && !summary) return null;

    const friend = buildFriendFromIntra(
      login,
      user,
      summary,
      cursus,
      lastOnline[login] ?? null,
    );
    if (friend.isOnline) lastOnline[login] = now;

    return applyIntraVisuals(friend, visuals);
  });

  await chrome.storage.local.set({ [LAST_ONLINE_KEY]: lastOnline });
  return results.filter((f): f is FriendData => f !== null);
}
