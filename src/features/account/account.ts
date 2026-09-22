import { BetterIntraConfig, getConfig, CLOUD_SYNC_KEYS } from "../../core/config.ts";
import type { VisualUrls } from "../profile/header/visuals-types.ts";
import { hashLogin } from "../../core/crypto.ts";
import { showConfirmDialog } from "../../core/dom/confirm-dialog.ts";
import { AUTH_FLOW_TTL_MS, markAuthFlowPending } from "./auth-callback.ts";
import { sanitizeVisualUrls } from "../profile/header/visuals-sanitize.ts";
import { isValidStoredValue } from "../../core/config/access.ts";

export { hashLogin };

import {
  WORKER_URL,
  AUTH_MODE,
  markAuthFailed,
  workerFetch,
  type WorkerCredentials,
  type WorkerResult,
} from "../../core/worker.ts";
import {
  loginWithIntraSession,
  requestIntraLoginFromActiveTab,
} from "./intra-login.ts";

const PRIVATE_SETTINGS = "/api/v1/private/settings";

/** Where the popup keeps the session count it last saw, for its first paint. */
const LAST_SESSIONS_KEY = "CLOUD_LAST_SESSIONS";

async function cloudCredentials(): Promise<WorkerCredentials | null> {
  const login = await getCloudLogin();
  const token = await getConfig("CLOUD_TOKEN");
  if (!login || !token) return null;
  return { login, token };
}

/**
 * Why a call to a private route failed. "auth" covers the 401 (flagged by
 * workerFetch) and the 404 the worker answers once the record is gone (Wipe
 * from another device): the token pair is kept, since a KV read right after
 * a sign-in can transiently miss the record too, but the popup, the hub and
 * the friends widget must offer "Reconnect" rather than call it "Offline".
 */
async function privateFailure(res: WorkerResult): Promise<CloudFailure> {
  if (res.status === 404) await markAuthFailed();
  if (res.status === 401 || res.status === 404) return "auth";
  return res.status === 0 ? "network" : "rejected";
}

export async function clearAuthFailed(): Promise<void> {
  await chrome.storage.local.remove("CLOUD_AUTH_FAILED");
}

/**
 * Initiates the 42 OAuth login flow by opening a popup window.
 * It listens for a message from the popup to receive the session token upon success.
 * @param onSuccess Optional callback to run after a successful login.
 */
export async function loginWith42(
  onSuccess?: () => void | Promise<void>,
): Promise<void> {
  const extensionFakeCallback = window.location.href;
  const authUrl = `${WORKER_URL}/login?redirect_uri=${encodeURIComponent(extensionFakeCallback)}`;

  const WORKER_ORIGIN = new URL(WORKER_URL).origin;
  const isExtension =
    window.location.protocol === "chrome-extension:" ||
    window.location.protocol === "moz-extension:";

  if (AUTH_MODE === "intra") {
    // Self-hosted worker without a 42 OAuth application: sign in with the
    // Intra session token, straight from the page (or via the active Intra
    // tab when called from the toolbar popup). No popup window at all.
    const result = isExtension
      ? await requestIntraLoginFromActiveTab()
      : await loginWithIntraSession();
    if (!result.ok) {
      alert(`Better Intra login failed.\n${result.error ?? ""}`);
      return;
    }
    if (onSuccess) await onSuccess();
    else window.location.reload();
    return;
  }

  if (isExtension) {
    // Toolbar popup. The browser destroys this popup as soon as the auth
    // window takes focus, so: (1) the "login in progress" marker must be
    // fully written BEFORE the window opens, otherwise the write can be lost
    // with the popup and the callback page refuses the login; (2) nothing
    // here can act as an opener. The content script on the worker's callback
    // page (auth-callback.js) finishes the login, the background reloads the
    // Intra tabs when CLOUD_TOKEN changes, and popup.ts closes itself.
    await markAuthFlowPending("cloud");
    try {
      await chrome.windows.create({
        url: authUrl,
        type: "popup",
        width: 600,
        height: 700,
        focused: true,
      });
    } catch {
      window.open(authUrl, "_blank");
    }
    return;
  }

  // In-page (hub) login: this page survives, so it also receives the worker's
  // postMessage through the opener path below.
  // Marker started before, awaited after window.open(): an await in between
  // would leave the click's transient activation and get the popup blocked.
  const marked = markAuthFlowPending("cloud");

  const popup = window.open(
    authUrl,
    "42 Authentication",
    "width=600,height=700",
  );

  await marked;
  if (!popup) {
    alert("Popup blocked! Please allow popups for this site.");
    return;
  }

  // Everything below exists for this one login attempt: `stopWaiting` takes
  // it all down (message listener, close poll, deadline, pagehide hook) the
  // moment the attempt succeeds, the window closes, the flow expires or the
  // page goes away - whichever comes first, and only once.
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let waiting = true;
  const stopWaiting = () => {
    if (!waiting) return;
    waiting = false;
    window.removeEventListener("message", messageListener);
    window.removeEventListener("pagehide", stopWaiting);
    if (pollInterval !== undefined) clearInterval(pollInterval);
    if (deadline !== undefined) clearTimeout(deadline);
  };

  const messageListener = async (event: MessageEvent) => {
    if (
      event.origin !== WORKER_ORIGIN &&
      event.origin !== "https://profile.intra.42.fr" &&
      event.origin !== "https://profile-v3.intra.42.fr"
    )
      return;

    if (event.data && event.data.type === "42_AUTH_SUCCESS") {
      const { token, login } = event.data;

      if (token && login) {
        // Claimed before the storage write: the close poll must not see the
        // window go away meanwhile and finish the same login a second time.
        stopWaiting();
        await chrome.storage.local.set({
          CLOUD_TOKEN: token,
          CLOUD_LOGIN: login,
          PENDING_SETTINGS_RESTORE: true,
        });

        popup.close();
        if (onSuccess) {
          await onSuccess();
        } else {
          window.location.reload();
        }
      }
    }
  };

  window.addEventListener("message", messageListener);
  window.addEventListener("pagehide", stopWaiting);

  // Fallback when the postMessage never arrives (e.g. the auth window was
  // closed by the callback content script): once the window is gone, check
  // whether the login was stored and finish the same way. A closing window
  // fires no event its opener can hear, hence the poll.
  pollInterval = setInterval(async () => {
    if (!popup.closed) return;
    stopWaiting();
    await new Promise((r) => setTimeout(r, 300));
    const savedLogin = await getCloudLogin();
    const savedToken = await getConfig("CLOUD_TOKEN");
    if (savedLogin && savedToken) {
      if (onSuccess) await onSuccess();
      else window.location.reload();
    }
  }, 500);

  // A window left open forever used to keep the poll running for the life of
  // the page. The callback page stops honouring this flow after
  // AUTH_FLOW_TTL_MS (auth-callback.ts), so there is nothing to wait for
  // past that point either.
  deadline = setTimeout(stopWaiting, AUTH_FLOW_TTL_MS);
}

/**
 * Retrieves the stored 42 login from local storage.
 * @returns A promise that resolves to the login string or null if not found.
 */
export async function getCloudLogin(): Promise<string | null> {
  return (await getConfig("CLOUD_LOGIN")) || null;
}

export type PrivateSettingsResult =
  | {
      ok: true;
      settings: Partial<BetterIntraConfig>;
      activeSessions: number;
    }
  | { ok: false; reason: CloudFailure };

/**
 * GET the private settings document. With `meta`, only its metadata
 * (activeSessions, discordId...), without the settings blob: the popup opens
 * on it, and a user's custom CSS, presets and image histories are several KB
 * it has no use for. An older worker knows no `fields` and answers the whole
 * document, which serves just as well; a 404 there is retried without the
 * filter before it is taken for a missing record.
 */
export async function fetchPrivateSettings(
  options: { meta?: boolean } = {},
): Promise<PrivateSettingsResult> {
  const auth = await cloudCredentials();
  if (!auth) return { ok: false, reason: "auth" };

  let res = await workerFetch(
    options.meta ? `${PRIVATE_SETTINGS}?fields=meta` : PRIVATE_SETTINGS,
    { auth },
  );
  if (options.meta && res.status === 404) {
    res = await workerFetch(PRIVATE_SETTINGS, { auth });
  }
  if (!res.ok) {
    const reason = await privateFailure(res);
    if (reason !== "auth") {
      console.error(
        "[fetchPrivateSettings] failed:",
        res.status,
        res.message ?? res.text,
      );
    }
    return { ok: false, reason };
  }
  const data = (res.json ?? {}) as Record<string, unknown>;
  const settings =
    data.settings && typeof data.settings === "object"
      ? (data.settings as Partial<BetterIntraConfig>)
      : {};
  return {
    ok: true,
    settings,
    activeSessions: Number(data.activeSessions ?? 0),
  };
}

/** The session count the popup last saw, or null when it never did. */
export async function getLastKnownSessions(): Promise<number | null> {
  try {
    const store = await chrome.storage.local.get(LAST_SESSIONS_KEY);
    const value = store[LAST_SESSIONS_KEY];
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Asks the worker how many sessions the account has and remembers the answer
 * for the popup's next first paint.
 * @returns The count, or null when the worker did not answer (or refused).
 */
export async function refreshSessionCount(): Promise<number | null> {
  const result = await fetchPrivateSettings({ meta: true });
  if (!result.ok) return null;
  await chrome.storage.local.set({
    [LAST_SESSIONS_KEY]: result.activeSessions,
  });
  return result.activeSessions;
}

/**
 * Tests the connection to the worker by fetching the number of active sessions.
 * @returns A promise that resolves to the number of active sessions, or 0 on failure.
 */
export async function testCloudConnection(): Promise<number> {
  return (await refreshSessionCount()) ?? 0;
}

export type CloudFailure = "auth" | "network" | "rejected";
export type PushResult = "ok" | CloudFailure;

/**
 * Gathers all local settings (except cloud credentials) and pushes them to the cloud.
 * "network": no answer in time; "auth": the session is gone (CLOUD_AUTH_FAILED
 * is set, the popup offers Reconnect); "rejected": any other worker error.
 */
export async function pushSettings(): Promise<PushResult> {
  const auth = await cloudCredentials();
  if (!auth) return "auth";

  const settings: Partial<BetterIntraConfig> = {};
  for (const key of CLOUD_SYNC_KEYS) {
    (settings as Record<string, unknown>)[key] = await getConfig(key);
  }

  const res = await workerFetch(PRIVATE_SETTINGS, {
    method: "POST",
    body: { settings },
    auth,
  });
  if (res.ok) {
    await chrome.storage.local.set({ LAST_CLOUD_SYNC: Date.now() });
    return "ok";
  }
  const reason = await privateFailure(res);
  if (reason === "rejected") {
    console.error("Cloud sync failed:", res.status, res.message ?? res.text);
  }
  return reason;
}

/**
 * Gathers all local settings (except cloud credentials) and pushes them to the cloud.
 * @returns A promise that resolves to true on success, false on failure.
 */
export async function syncToCloud(): Promise<boolean> {
  return (await pushSettings()) === "ok";
}

/**
 * A specialized sync function to quickly update only the user's visual settings.
 * @param visuals An object containing URLs and modes for profile visuals.
 */
export async function syncMyVisuals(visuals: {
  avatar: string;
  banner: string;
  bannerMode?: string;
  bannerColor?: string;
  background: string;
  backgroundMode?: string;
  backgroundColor?: string;
  avatarBg?: string;
  decoration?: string;
  avatarPosX?: number;
  avatarPosY?: number;
  avatarScale?: number;
  badgeBg?: string;
}): Promise<void> {
  const auth = await cloudCredentials();
  if (!auth) return;

  const res = await workerFetch(PRIVATE_SETTINGS, {
    method: "POST",
    auth,
    body: {
      settings: {
        PROFILE_IMAGE_URL: visuals.avatar,
        PROFILE_BANNER_URL: visuals.banner,
        PROFILE_BANNER_MODE: visuals.bannerMode || "fill",
        PROFILE_BANNER_COLOR: visuals.bannerColor || "",
        PROFILE_BACKGROUND_URL: visuals.background,
        PROFILE_BACKGROUND_MODE: visuals.backgroundMode || "fill",
        PROFILE_BACKGROUND_COLOR: visuals.backgroundColor || "",
        PROFILE_AVATAR_BG: visuals.avatarBg || "transparent",
        PROFILE_DECORATION: visuals.decoration || "none",
        PROFILE_AVATAR_POSITION_X: visuals.avatarPosX ?? 50,
        PROFILE_AVATAR_POSITION_Y: visuals.avatarPosY ?? 50,
        PROFILE_AVATAR_SCALE: visuals.avatarScale ?? 100,
        PROFILE_BADGE_BG: visuals.badgeBg || "",
        PROFILE_IMAGE_HISTORY: await getConfig("PROFILE_IMAGE_HISTORY"),
        PROFILE_BANNER_HISTORY: await getConfig("PROFILE_BANNER_HISTORY"),
        PROFILE_BACKGROUND_HISTORY: await getConfig(
          "PROFILE_BACKGROUND_HISTORY",
        ),
      },
    },
  });
  if (!res.ok) {
    await privateFailure(res);
    console.error("Cloud Quick Sync Error:", res.status, res.message ?? res.text);
  }
}

/**
 * Fetches the public visual settings for a given user login.
 * @param login The target user's 42 login.
 * @returns A promise that resolves to the user's visual settings, or null on failure.
 */
export async function fetchUserVisuals(
  login: string,
): Promise<VisualUrls | null> {
  try {
    const hashedTarget = await hashLogin(login);
    const response = await workerFetch(
      `/api/v1/public/visuals?login=${encodeURIComponent(hashedTarget)}`,
      { timeoutMs: 8_000 },
    );
    if (!response.ok || !response.json) return null;
    const data = response.json as Record<string, unknown>;

    // Another user's values: validate them once here so that every consumer
    // (cache, comparisons, applyImgs) sees the same sanitised object. Their
    // images are only shown from the allowlisted hosts (image-hosts.ts).
    return sanitizeVisualUrls({
      avatar: String(data.avatar || ""),
      banner: String(data.banner || ""),
      bannerMode: String(data.bannerMode || "fill"),
      bannerColor: String(data.bannerColor || ""),
      background: String(data.background || ""),
      backgroundMode: String(data.backgroundMode || "fill"),
      backgroundColor: String(data.backgroundColor || ""),
      avatarBg: String(data.avatarBg || "transparent"),
      decoration: String(data.decoration || "none"),
      avatarPosX: Number(data.avatarPosX ?? 50),
      avatarPosY: Number(data.avatarPosY ?? 50),
      avatarScale: Number(data.avatarScale ?? 100),
      badgeBg: String(data.badgeBg || ""),
      theme: (data.theme as { profileColor?: string }) || null,
      logtime: (data.logtime as Record<string, unknown>) || null,
      look: (data.look as Record<string, unknown>) || null,
      extras: (data.extras as Record<string, unknown>) || null,
    }, { images: "allowlist" });
  } catch (error) {
    console.error(error);
    return null;
  }
}

/**
 * Fetches the current user's settings from the cloud.
 * @returns A promise that resolves to a partial config object, or null on failure.
 */
export async function fetchMySettings(): Promise<Partial<BetterIntraConfig> | null> {
  const result = await fetchPrivateSettings();
  return result.ok ? result.settings : null;
}

/** Whether a cloud document holds anything worth restoring. */
export function hasCloudData(settings: Partial<BetterIntraConfig>): boolean {
  return Object.entries(settings).some(
    ([k, v]) =>
      k !== "CLOUD_TOKEN" && k !== "CLOUD_LOGIN" && v != null && v !== "",
  );
}

/**
 * Logs the user out by deleting the current session from the worker and clearing local credentials.
 * @returns A promise that resolves to true on success.
 */
export async function logoutCloud(): Promise<boolean> {
  const auth = await cloudCredentials();
  if (auth) {
    const res = await workerFetch(PRIVATE_SETTINGS, { method: "DELETE", auth });
    if (!res.ok) {
      console.error("Failed to notify worker of logout", res.status, res.text);
    }
  }

  await chrome.storage.local.remove([
    "CLOUD_TOKEN",
    "CLOUD_LOGIN",
    "CLOUD_AUTH_FAILED",
    LAST_SESSIONS_KEY,
  ]);
  return true;
}

/**
 * Sends a request to the worker to wipe all cloud data associated with the user's account.
 * @returns A promise that resolves to true on success, false on failure.
 */
export async function wipeAllCloudData(): Promise<boolean> {
  const auth = await cloudCredentials();
  if (!auth) return false;

  const response = await workerFetch(`${PRIVATE_SETTINGS}?all=true`, {
    method: "DELETE",
    auth,
    timeoutMs: 20_000,
  });
  if (response.ok) {
    // The worker revoked every calendar link: forget ours too, or the
    // panel keeps showing (and the next push re-uploads) a dead one.
    await chrome.storage.local.remove([
      "CLOUD_TOKEN",
      "CLOUD_LOGIN",
      "CLOUD_AUTH_FAILED",
      LAST_SESSIONS_KEY,
      "CALENDAR_SYNC_TOKEN",
      "CALENDAR_EVENTS_HASH",
    ]);
    return true;
  }
  console.error("Wipe cloud data failed:", response.status, response.text);
  return false;
}

/**
 * Applies a set of settings from the cloud to the local storage.
 * @param cloudData A partial configuration object from the cloud.
 */
export async function applyCloudSettings(
  cloudData: Partial<BetterIntraConfig>,
): Promise<void> {
  const dataToSave: Partial<BetterIntraConfig> = {};

  for (const key of CLOUD_SYNC_KEYS) {
    if (!(key in cloudData)) continue;
    const value = (cloudData as Record<string, unknown>)[key];
    // A malformed cloud copy (another build, a hand-edited push) must not
    // store what a backup import refuses: getConfig would throw on it.
    if (!isValidStoredValue(key, value)) continue;
    (dataToSave as Record<string, unknown>)[key] = value;
  }

  if (Object.keys(dataToSave).length > 0) {
    await chrome.storage.local.set(dataToSave as Record<string, unknown>);
  }
}

/**
 * Prompts the user to restore their cloud settings after a fresh 42 connect.
 * Triggered once per connect via the PENDING_SETTINGS_RESTORE flag.
 */
export async function maybePromptRestore(): Promise<void> {
  const pending = (await chrome.storage.local.get(
    "PENDING_SETTINGS_RESTORE",
  )) as Record<string, unknown>;
  if (!pending.PENDING_SETTINGS_RESTORE) return;
  await chrome.storage.local.remove("PENDING_SETTINGS_RESTORE");

  const login = await getCloudLogin();
  const token = await getConfig("CLOUD_TOKEN");
  if (!login || !token) return;

  const settings = await fetchMySettings();
  if (!settings) return;

  if (
    hasCloudData(settings) &&
    (await showConfirmDialog({
      message: "Cloud backup found. Restore your settings?",
      confirmLabel: "Restore",
      cancelLabel: "Cancel",
    }))
  ) {
    await applyCloudSettings(settings);
    window.location.reload();
  }
}
