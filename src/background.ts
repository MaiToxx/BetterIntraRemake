/**
 * The extension's background service worker. It owns the three jobs a content
 * script cannot do itself: the periodic GitHub release check (badge + stored
 * UpdateInfo), fetching Intra pages cross-origin with the user's cookies, and
 * reloading the open Intra tabs once a new cloud session is stored.
 */
import {
  UPDATE_KEY,
  isNewerVersion,
  parseLatestRelease,
  type UpdateInfo,
} from "./core/update-check";

// ---------------------------------------------------------------------------
// Update check (GitHub Releases of __REPO_URL__)
// ---------------------------------------------------------------------------
const UPDATE_ALARM = "better-intra-update-check";
const UPDATE_PERIOD_MINUTES = 6 * 60;
const RELEASES_API = __REPO_RELEASES_API__;
/** Delay between a new CLOUD_TOKEN and the Intra tabs reload (see onChanged). */
const RELOAD_AFTER_LOGIN_DELAY_MS = 500;

/**
 * In-flight update check. The alarm, the browser start-up and the popup's
 * FT_CHECK_UPDATE can land in the same service-worker lifetime; a second
 * GitHub request would only get the same answer (and count against the
 * unauthenticated rate limit twice).
 */
let updateCheckInFlight: Promise<void> | null = null;

function checkForUpdate(): Promise<void> {
  if (updateCheckInFlight) return updateCheckInFlight;
  updateCheckInFlight = runUpdateCheck().finally(() => {
    updateCheckInFlight = null;
  });
  return updateCheckInFlight;
}

async function runUpdateCheck(): Promise<void> {
  const current = chrome.runtime.getManifest().version;
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return; // rate-limited or no release yet: keep previous state
    const latest = parseLatestRelease(await res.json());
    if (!latest) return;
    if (isNewerVersion(latest.version, current)) {
      const info: UpdateInfo = {
        version: latest.version,
        url: latest.url,
        checkedAt: Date.now(),
      };
      await chrome.storage.local.set({ [UPDATE_KEY]: info });
      await chrome.action.setBadgeBackgroundColor({ color: "#00babc" });
      await chrome.action.setBadgeText({ text: "NEW" });
    } else {
      await chrome.storage.local.remove(UPDATE_KEY);
      await chrome.action.setBadgeText({ text: "" });
    }
  } catch {
    console.warn("checkForUpdate: fetch failed");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // a fresh install/update is by definition up to date: clear any stale flag
  void chrome.storage.local.remove(UPDATE_KEY);
  void chrome.action.setBadgeText({ text: "" });
  chrome.alarms.create(UPDATE_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: UPDATE_PERIOD_MINUTES,
  });
});

chrome.runtime.onStartup.addListener(() => {
  void checkForUpdate();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) void checkForUpdate();
});

chrome.storage.onChanged.addListener((changes) => {
  if ("CLOUD_TOKEN" in changes && changes.CLOUD_TOKEN.newValue) {
    // Give the content script that just stored the session time to answer
    // the popup (FT_INTRA_LOGIN) before its tab is torn down by the reload.
    setTimeout(() => void reloadIntraTabs(), RELOAD_AFTER_LOGIN_DELAY_MS);
  }
});

/**
 * Fetch an Intra page on behalf of a content script (cross-origin, with the
 * user's Intra cookies). Content scripts are bound by the page's CORS; the
 * background is not, thanks to the *.intra.42.fr host permission.
 */
async function fetchIntraPage(
  url: unknown,
): Promise<{ ok: boolean; status?: number; text?: string }> {
  if (typeof url !== "string") return { ok: false };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false };
  }
  if (
    parsed.protocol !== "https:" ||
    !/(^|\.)intra\.42\.fr$/.test(parsed.hostname)
  ) {
    return { ok: false };
  }
  try {
    const res = await fetch(parsed.toString(), {
      credentials: "include",
      redirect: "follow",
    });
    // a redirect to the sign-in page means the session is gone
    if (!res.ok || /signin\.intra\.42\.fr/.test(res.url)) {
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status, text: await res.text() };
  } catch {
    return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FT_FETCH_INTRA_PAGE") {
    fetchIntraPage(message.url)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "FT_CHECK_UPDATE") {
    checkForUpdate()
      .catch(() => undefined)
      .finally(() => sendResponse(true));
    return true;
  }
  if (message?.type === "FT_RELOAD_INTRA_TABS") {
    reloadIntraTabs()
      .catch(() => undefined)
      .finally(sendResponse);
    return true;
  }
  return undefined;
});

/** Reload every open Intra tab so content scripts pick up the new session. */
async function reloadIntraTabs() {
  const tabs = await chrome.tabs.query({ url: "https://*.intra.42.fr/*" });
  // nothing to refresh: never reload an unrelated active tab
  if (tabs.length === 0) return;
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.reload(tab.id);
  }
}
