import {
  applyCloudSettings,
  clearAuthFailed,
  fetchPrivateSettings,
  hasCloudData,
  loginWith42,
  logoutCloud,
  pushSettings,
  wipeAllCloudData,
  type CloudFailure,
} from "./account";
import { AccountState, resetButtonState } from "./state";
import { WORKER_ORIGIN_PATTERN } from "../../core/worker.ts";

/** Hosts the extension must be allowed on for the login flow to complete. */
const REQUIRED_ORIGINS = [
  "https://*.intra.42.fr/*",
  WORKER_ORIGIN_PATTERN,
];

/**
 * Firefox treats the host permissions of a Manifest V3 extension as optional:
 * until the user grants them, no content script runs, including the one that
 * finishes the login on the worker's callback page. Ask from the click
 * handler (a user gesture is required); on Chrome, and once granted, this
 * resolves immediately without any prompt.
 */
async function ensureHostPermissions(): Promise<void> {
  try {
    await chrome.permissions.request({ origins: REQUIRED_ORIGINS });
  } catch {
    /* API unavailable or refused: the opener path may still work */
  }
}

/** The button label for a failed Push or Pull; the Reconnect banner comes from updateUI. */
function failureLabel(reason: CloudFailure): string {
  if (reason === "auth") return "Session expired";
  if (reason === "network") return "Connection Failed";
  return "Sync Failed";
}

/**
 * @param updateUI Re-renders from storage and `state`; never talks to the worker.
 */
export function createHandlers(state: AccountState, updateUI: () => void) {
  const handleLogin42 = async () => {
    await ensureHostPermissions();
    loginWith42(async () => {
      await clearAuthFailed();
      void chrome.runtime
        .sendMessage({ type: "FT_RELOAD_INTRA_TABS" })
        .catch(() => reloadActiveTab());
      window.close();
    });
  };

  const reloadActiveTab = async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) chrome.tabs.reload(tab.id);
  };

  const reloadTab = async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) chrome.tabs.reload(tab.id);
  };

  const handleDelete = async () => {
    if (confirm("Disconnect and clear your cloud session data locally?")) {
      await logoutCloud();
      await reloadTab();
    }
  };

  const handleWipe = async () => {
    if (
      !confirm(
        "This permanently deletes everything the Better Intra server holds for you: your pushed settings, every signed-in session, your calendar link and your entry in the community counter. Your local settings stay. Continue?",
      )
    )
      return;

    const success = await wipeAllCloudData();
    if (success) {
      alert("All cloud data successfully wiped.");
      await reloadTab();
    } else {
      alert("Failed to delete cloud data. Please try again.");
    }
  };

  const handlePush = async () => {
    if (state.buttons.push.loading) return;

    // One POST, no probe first: the request's own outcome tells network from
    // session from worker error, and the button reacts on the click itself.
    state.buttons.push = { loading: true, text: "Connecting..." } as any;
    updateUI();

    const result = await pushSettings();
    if (result === "ok") {
      await clearAuthFailed();
      state.cloud = "online";
      state.buttons.push = {
        loading: false,
        success: true,
        text: "Synced!",
      } as any;
    } else {
      if (result === "network") state.cloud = "offline";
      state.buttons.push = {
        loading: false,
        error: true,
        text: failureLabel(result),
      } as any;
    }
    updateUI();
    setTimeout(() => {
      resetButtonState(state, "push", "Push Settings");
      updateUI();
    }, 2500);
  };

  const handlePull = async () => {
    if (state.buttons.pull.loading) return;
    if (!confirm("Overwrite current local settings with cloud backup?")) return;

    state.buttons.pull = { loading: true, text: "Connecting..." } as any;
    updateUI();

    // The one GET serves the restore and the session count alike.
    const result = await fetchPrivateSettings();
    if (result.ok) {
      state.cloud = "online";
      state.activeSessions = result.activeSessions;
    } else if (result.reason === "network") {
      state.cloud = "offline";
    }

    if (result.ok && hasCloudData(result.settings)) {
      await clearAuthFailed();
      await applyCloudSettings(result.settings);
      await chrome.storage.local.set({ LAST_CLOUD_SYNC: Date.now() });
      state.buttons.pull = {
        loading: false,
        success: true,
        text: "Restored!",
      } as any;
      updateUI();
      setTimeout(() => reloadTab(), 1500);
      return;
    }

    // An empty document is a real answer, not a failure to reach the worker:
    // "No Data Found" used to cover a flaky connection as well.
    state.buttons.pull = {
      loading: false,
      error: true,
      text: result.ok ? "No backup yet" : failureLabel(result.reason),
    } as any;
    updateUI();
    setTimeout(() => {
      resetButtonState(state, "pull", "Pull Settings");
      updateUI();
    }, 2000);
  };

  return {
    handleLogin42,
    handleDelete,
    handleWipe,
    handlePush,
    handlePull,
  };
}
