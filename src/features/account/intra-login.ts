/**
 * Login without a 42 OAuth application ("intra" auth mode).
 *
 * The Intra v3 front-end authenticates its API calls with a Keycloak token
 * that hook.js captures on every page (sessionStorage "ft_intrapy_token").
 * The self-hosted worker verifies that token's signature against Keycloak's
 * public keys and opens a Better Intra session for its login. No popup, no
 * redirect, no application to register on the Intra.
 *
 * Only usable from a content script on an Intra page (the token lives there);
 * the toolbar popup asks the active Intra tab to do it (FT_INTRA_LOGIN).
 */
import {
  getStoredIntrapyToken,
  isJwtExpired,
  waitForIntrapyToken,
} from "../../core/intra/intrapy.ts";
import { WORKER_URL } from "../../core/worker.ts";

export const INTRA_LOGIN_MESSAGE = "FT_INTRA_LOGIN";
/**
 * How long to wait for the page to authenticate a request. When the cached
 * token is an expired JWT, a fresh one only shows up once the Intra front-end
 * refreshes its Keycloak session and calls its API again, which can take a
 * few seconds after a reload.
 */
const TOKEN_WAIT_MS = 8000;

export interface IntraLoginResult {
  ok: boolean;
  login?: string;
  error?: string;
}

export async function loginWithIntraSession(): Promise<IntraLoginResult> {
  const token = await waitForIntrapyToken(TOKEN_WAIT_MS);
  if (!token) {
    // The token is only issued to the Intra v3 front-end: on the old v2 pages
    // (profile.intra.42.fr, projects.intra.42.fr...) there is nothing to read.
    const onV3 = location.hostname === "profile-v3.intra.42.fr";
    if (onV3 && isJwtExpired(getStoredIntrapyToken())) {
      return {
        ok: false,
        error:
          "The Intra session token on this page has expired and the page did not issue a new one. Reload the page, wait a few seconds and try again.",
      };
    }
    return {
      ok: false,
      error: onV3
        ? "No Intra session token found on this page yet. Reload the page, wait a few seconds and try again."
        : "Sign in from the Intra v3 profile page: open https://profile-v3.intra.42.fr/ and click Connect with 42 there.",
    };
  }

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/auth/intra`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    return {
      ok: false,
      error: `Could not reach the Better Intra server (${new URL(WORKER_URL).host}). If the extension asked for access to that site, click Allow, then retry.\nBetter Intra ${__APP_VERSION__}`,
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Server refused the login (${res.status}): ${text.slice(0, 200)}\nBetter Intra ${__APP_VERSION__} · ${location.hostname}`,
    };
  }

  const data = (await res.json()) as { token?: string; login?: string };
  if (!data.token || !data.login) {
    return { ok: false, error: "Unexpected server response." };
  }

  await chrome.storage.local.set({
    CLOUD_TOKEN: data.token,
    CLOUD_LOGIN: data.login,
    PENDING_SETTINGS_RESTORE: true,
  });
  await chrome.storage.local.remove("CLOUD_AUTH_FAILED");
  return { ok: true, login: data.login };
}

/**
 * From the toolbar popup: ask the active tab (which must be an Intra page) to
 * perform the login, since only the page has the Intra token.
 */
export async function requestIntraLoginFromActiveTab(): Promise<IntraLoginResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/profile-v3\.intra\.42\.fr\//.test(tab.url || "")) {
    // open the v3 profile (the only place the Intra token exists) and let the
    // user click Connect with 42 in the hub there
    try {
      await chrome.tabs.create({ url: "https://profile-v3.intra.42.fr/" });
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error:
        "Sign in from the Intra v3 profile page (just opened): click Connect with 42 in the Better Intra hub there.",
    };
  }
  // The content script stores the session before answering, and the
  // background reloads Intra tabs as soon as CLOUD_TOKEN changes. When the
  // reload wins the race the answer is lost and sendMessage rejects, even
  // though the login succeeded: the token that appeared in storage is the
  // proof (worker sessions are fresh UUIDs, so a changed token is a new login).
  const before = await readStoredSession();
  try {
    const result = (await chrome.tabs.sendMessage(tab.id, {
      type: INTRA_LOGIN_MESSAGE,
    })) as IntraLoginResult | undefined;
    return result ?? { ok: false, error: "No answer from the Intra page." };
  } catch {
    const after = await readStoredSession();
    if (after.token && after.login && after.token !== before.token) {
      return { ok: true, login: after.login };
    }
    return {
      ok: false,
      error:
        "Better Intra is not running on this tab yet. Reload the Intra page and try again.",
    };
  }
}

async function readStoredSession(): Promise<{
  token: string | null;
  login: string | null;
}> {
  try {
    const store = await chrome.storage.local.get(["CLOUD_TOKEN", "CLOUD_LOGIN"]);
    const token = typeof store.CLOUD_TOKEN === "string" ? store.CLOUD_TOKEN : null;
    const login = typeof store.CLOUD_LOGIN === "string" ? store.CLOUD_LOGIN : null;
    return { token, login };
  } catch {
    return { token: null, login: null };
  }
}
