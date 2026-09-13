import { hashLogin } from "./utils/crypto";
import {
  UPDATE_KEY,
  isNewerVersion,
  parseLatestRelease,
  type UpdateInfo,
} from "./utils/update-check";

const WORKER_URL = "https://api.betterintra.com";

// ---------------------------------------------------------------------------
// Update check (GitHub Releases of __REPO_URL__)
// ---------------------------------------------------------------------------
const UPDATE_ALARM = "better-intra-update-check";
const UPDATE_PERIOD_MINUTES = 6 * 60;
const RELEASES_API = __REPO_RELEASES_API__;

async function checkForUpdate(): Promise<void> {
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
  syncDiscord();
  syncDiscordQuiet();
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
  if ("DISCORD_ENABLED" in changes || "DISCORD_ID" in changes) {
    syncDiscord();
  }
  if ("DISCORD_ID" in changes && !changes.DISCORD_ID.newValue) {
    syncRegistration();
  }
  if ("DISCORD_ENABLED" in changes && !changes.DISCORD_ENABLED.newValue) {
    syncRegistration();
  }
  if (
    "DISCORD_QUIET_ENABLED" in changes ||
    "DISCORD_QUIET_START" in changes ||
    "DISCORD_QUIET_END" in changes
  ) {
    syncDiscordQuiet();
  }
  if ("CLOUD_TOKEN" in changes && changes.CLOUD_TOKEN.newValue) {
    reloadIntraTabs();
  }
});

async function syncRegistration() {
  const store = await chrome.storage.local.get([
    "CLOUD_TOKEN",
    "CLOUD_LOGIN",
    "DISCORD_ENABLED",
    "DISCORD_ID",
  ]);
  const token = String(store.CLOUD_TOKEN || "");
  const cloudLogin = String(store.CLOUD_LOGIN || "");
  if (!token || !cloudLogin) return;

  const discordEnabled = store.DISCORD_ENABLED === true;
  const discordId = String(store.DISCORD_ID || "").trim();
  if (discordEnabled && discordId) return;

  const hashedLogin = await hashLogin(cloudLogin);
  const url = `${WORKER_URL}/api/v1/private/evaluations?login=${encodeURIComponent(hashedLogin)}&action=unregister`;

  try {
    await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    console.warn("syncRegistration: fetch failed");
  }
}

async function syncDiscord() {
  const store = await chrome.storage.local.get([
    "CLOUD_TOKEN",
    "CLOUD_LOGIN",
    "DISCORD_ENABLED",
    "DISCORD_ID",
  ]);
  const token = String(store.CLOUD_TOKEN || "");
  const cloudLogin = String(store.CLOUD_LOGIN || "");
  if (!token || !cloudLogin) return;

  const hashedLogin = await hashLogin(cloudLogin);
  const enabled = store.DISCORD_ENABLED === true;
  const discordId = String(store.DISCORD_ID || "").trim();

  if (enabled && discordId) {
    const url = `${WORKER_URL}/api/v1/private/discord/link?login=${encodeURIComponent(hashedLogin)}`;
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ discordId }),
      });
    } catch {
      console.warn("syncDiscord: link fetch failed");
    }
  } else if (!discordId) {
    const url = `${WORKER_URL}/api/v1/private/discord/unlink?login=${encodeURIComponent(hashedLogin)}`;
    try {
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      console.warn("syncDiscord: unlink fetch failed");
    }
  }
}

async function syncDiscordQuiet() {
  const store = await chrome.storage.local.get([
    "CLOUD_TOKEN",
    "CLOUD_LOGIN",
    "DISCORD_QUIET_ENABLED",
    "DISCORD_QUIET_START",
    "DISCORD_QUIET_END",
  ]);
  const token = String(store.CLOUD_TOKEN || "");
  const cloudLogin = String(store.CLOUD_LOGIN || "");
  if (!token || !cloudLogin) return;

  const hashedLogin = await hashLogin(cloudLogin);
  const url = `${WORKER_URL}/api/v1/private/discord/quiet?login=${encodeURIComponent(hashedLogin)}`;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quietEnabled: store.DISCORD_QUIET_ENABLED === true,
        quietStart: String(store.DISCORD_QUIET_START || "22:00"),
        quietEnd: String(store.DISCORD_QUIET_END || "08:00"),
        timezoneOffset: new Date().getTimezoneOffset(),
      }),
    });
  } catch {
    console.warn("syncDiscordQuiet: fetch failed");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

async function reloadIntraTabs() {
  const tabs = await chrome.tabs.query({ url: "https://*.intra.42.fr/*" });
  if (tabs.length === 0) {
    const [active] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (active?.id) chrome.tabs.reload(active.id);
    return;
  }
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.reload(tab.id);
  }
}
