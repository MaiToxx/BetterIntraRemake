/**
 * Everything the profile visuals remember between two mutation passes: the
 * signed-in login, each viewed user's visuals in storage, the logins known to
 * have none, and a memo of the key that says "already applied".
 *
 * WHY a module of its own: updateVisuals() runs on every burst of DOM
 * mutations, so these caches are what keeps a pass cheap. They hold no DOM
 * and do not know how visuals are painted, which lets visuals.ts read as the
 * decision it is ("fetch, reuse or skip?") instead of as storage plumbing.
 */
import { getCloudLogin } from "../../account/account.ts";
import type { VisualUrls } from "./visuals-types.ts";

// ---------------------------------------------------------------------------
// The signed-in login
// ---------------------------------------------------------------------------

/**
 * The signed-in login, read once per page instead of once per mutation pass.
 *
 * WHY: updateVisuals() runs on every burst of DOM mutations and used to await
 * a chrome.storage round-trip for a value that only changes on login/logout -
 * which reloads every Intra tab anyway (background.ts). The storage listener
 * installed below drops the cache, so it stays exact even without that reload.
 */
let cachedOwnLogin: string | null | undefined;
let ownLoginPending: Promise<string | null> | null = null;

export const readOwnLogin = async (): Promise<string | null> => {
  if (cachedOwnLogin !== undefined) return cachedOwnLogin;
  if (!ownLoginPending) {
    ownLoginPending = getCloudLogin()
      .then((login) => {
        cachedOwnLogin = login;
        ownLoginPending = null;
        return login;
      })
      .catch((err) => {
        ownLoginPending = null;
        throw err;
      });
  }
  return ownLoginPending;
};

// ---------------------------------------------------------------------------
// Storage listener: login changes and the image url history
// ---------------------------------------------------------------------------

let historyListenerInstalled = false;

function addToHistory(url: string, history: string[]): string[] {
  if (!url) return history;
  const filtered = history.filter((h) => h !== url);
  return [url, ...filtered].slice(0, 10);
}

export function installHistoryListener(): void {
  if (historyListenerInstalled) return;
  historyListenerInstalled = true;

  const URL_KEYS = [
    "PROFILE_IMAGE_URL",
    "PROFILE_BANNER_URL",
    "PROFILE_BACKGROUND_URL",
  ] as const;
  const HISTORY_KEYS = {
    PROFILE_IMAGE_URL: "PROFILE_IMAGE_HISTORY",
    PROFILE_BANNER_URL: "PROFILE_BANNER_HISTORY",
    PROFILE_BACKGROUND_URL: "PROFILE_BACKGROUND_HISTORY",
  } as const;

  // Missing in a page that only got a partial chrome API shim: the cache above
  // then simply lives for the page, as it did before it existed.
  if (!chrome.storage.onChanged?.addListener) return;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("CLOUD_LOGIN" in changes) {
      cachedOwnLogin = undefined;
      ownLoginPending = null;
    }
    for (const key of URL_KEYS) {
      if (!(key in changes)) continue;
      const newUrl = changes[key].newValue as string | undefined;
      if (!newUrl) continue;
      const historyKey = HISTORY_KEYS[key];
      chrome.storage.local.get(historyKey).then(async (result) => {
        const history = (result[historyKey] as string[]) || [];
        const updated = addToHistory(newUrl, history);
        if (updated !== history) {
          await chrome.storage.local.set({ [historyKey]: updated });
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// "Already applied?" key
// ---------------------------------------------------------------------------

/**
 * Memo for getVisualKey(): the same object is keyed several times per pass
 * (compare, then store) and the JSON it produces can be a couple of kilobytes
 * once a published look and its extras are in it. VisualUrls objects are
 * replaced, never mutated in place, so identity is a safe cache key.
 */
const visualKeyCache = new WeakMap<VisualUrls, string>();

export const getVisualKey = (urls: VisualUrls): string => {
  const cached = visualKeyCache.get(urls);
  if (cached !== undefined) return cached;
  const key = computeVisualKey(urls);
  visualKeyCache.set(urls, key);
  return key;
};

const computeVisualKey = (urls: VisualUrls) =>
  JSON.stringify({
    avatar: urls.avatar || "",
    banner: urls.banner || "",
    bannerMode: urls.bannerMode || "",
    bannerColor: urls.bannerColor || "",
    background: urls.background || "",
    backgroundMode: urls.backgroundMode || "",
    backgroundColor: urls.backgroundColor || "",
    avatarBg: urls.avatarBg || "transparent",
    decoration: urls.decoration || "none",
    avatarPosX: urls.avatarPosX ?? 50,
    avatarPosY: urls.avatarPosY ?? 50,
    avatarScale: urls.avatarScale ?? 100,
    badgeBg: urls.badgeBg || "",
    theme: urls.theme || null,
    logtime: urls.logtime || null,
    look: urls.look || null,
    extras: urls.extras || null,
  });

// ---------------------------------------------------------------------------
// Per-login visuals in storage, and the logins known to have none
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "visuals_cache_";

export const getCachedVisuals = async (
  login: string,
): Promise<VisualUrls | null> => {
  const result = (await chrome.storage.local.get(
    `${CACHE_PREFIX}${login}`,
  )) as Record<string, VisualUrls>;
  return result[`${CACHE_PREFIX}${login}`] || null;
};

export const setCachedVisuals = (login: string, urls: VisualUrls) => {
  chrome.storage.local.set({ [`${CACHE_PREFIX}${login}`]: urls });
};

/** Logins known to have no cloud visuals, with the time we learned it. */
const noVisualsCache = new Map<string, number>();
const NO_VISUALS_TTL_MS = 10 * 60 * 1000;

/** True when `login` was found without cloud visuals less than ten minutes ago. */
export function knownToHaveNoVisuals(login: string): boolean {
  const knownEmptyAt = noVisualsCache.get(login);
  return !!knownEmptyAt && Date.now() - knownEmptyAt < NO_VISUALS_TTL_MS;
}

export function rememberNoVisuals(login: string): void {
  noVisualsCache.set(login, Date.now());
}
