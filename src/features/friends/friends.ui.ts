/**
 * Entry point of the friends widget: mounts its shadow host on the page, owns
 * the one live WidgetState and wires every control to what it does (fetching,
 * adding and removing friends, persisting sort and filter choices, reconnect).
 * The markup lives in friends-panel.ts and the modules it pulls in.
 */
import { render } from "lit-html";
import {
  addFriend,
  cacheFriendData,
  checkFriendLogin,
  getFriendsList,
  isFriend,
  loadFriendsData,
  peekCachedFriends,
  removeFriend,
  type FriendsDetail,
} from "./friends.ts";
import {
  loginWith42,
  clearAuthFailed,
  syncToCloud,
} from "../account/account.ts";
import { getConfig } from "../../core/config.ts";
import { getIsLight } from "../../core/theme/theme-manager.ts";
import { bindTooltips } from "../../core/dom/tooltip.ts";
import { CLUSTERS, getClusterData } from "../clusters/clusters.data.ts";
import type { SortDir, SortMode } from "./friends-sort.ts";
import { followTheme, loadInitialData, type WidgetState } from "./friends-widget-state.ts";
import { renderWidget } from "./friends-panel.ts";

const HOST_ID = "friends-widget-host";

let _host: HTMLElement | null = null;
let _shadow: ShadowRoot | null = null;
let _state: WidgetState | null = null;
let themeUnfollow: (() => void) | null = null;
/** Each loadList() takes a number; only the latest one may write the state. */
let _loadGeneration = 0;
function renderWidgetUI() {
  if (_state && _shadow) render(renderWidget(_state), _shadow);
}

/** Close the panel and leave every mode it was in. */
function closePanel(state: WidgetState) {
  state.open = false;
  state.deleteMode = false;
  state.selected = [];
  state.addOpen = false;
}

/** The add error goes with the pending login it may offer to retry. */
function clearAddError(state: WidgetState) {
  state.addError = "";
  state.addPending = null;
}

/** What the panel needs right now: everything when open, the badge otherwise. */
function neededDetail(state: WidgetState): FriendsDetail {
  return state.open ? "full" : "online";
}

/**
 * The login verifyAddedLogin() is checking right now, if any: that check adds
 * its own row. onAdd clears addPending and keeps the login in the (disabled)
 * input; onRetryAdd checks addPending.
 */
function loginBeingAdded(state: WidgetState): string | null {
  if (!state.addLoading) return null;
  return state.addPending ?? (state.addInput.trim().toLowerCase() || null);
}

/**
 * Load the friends list into the state. `force` skips the fresh cache (the
 * refresh button). lastFetch only moves on a real success, so the refresh
 * tooltip no longer says "Updated just now" after a failure.
 *
 * The last cached rows are painted first, however old, so a stale cache
 * shows the list and the online badge at once instead of a spinner for the
 * whole fetch. A load that fails for any reason (a storage write, a rejected
 * body) still ends: it used to leave `loading` true and the skeleton up for
 * good, with the outside-click listener never installed.
 */
async function loadList(force: boolean, detail?: FriendsDetail) {
  const state = _state;
  if (!state) return;
  const generation = ++_loadGeneration;
  const current = () => _state === state && generation === _loadGeneration;
  const requested = detail ?? neededDetail(state);
  state.loading = true;
  state.loadError = false;
  renderWidgetUI();
  /** Logins saved while this load ran, which its answer has no row for. */
  let arrived = false;
  try {
    const list = await getFriendsList();
    if (state.friends.length === 0) {
      const peek = await peekCachedFriends(list);
      if (peek && peek.friends.length > 0 && current()) {
        state.friends = peek.friends;
        state.detailed = peek.full;
        state.lastFetch = peek.timestamp;
        renderWidgetUI();
      }
    }
    const result = await loadFriendsData(list, { force, detail: requested });
    if (!current()) return;
    // Removed while the load ran (a Remove button, the profile page): the
    // answer must not bring the login back.
    const keep = new Set(await getFriendsList());
    if (!current()) return;
    // Added while the load ran: the answer was built from the older list.
    // A row the widget's own Add already put in (verifyAddedLogin) stays,
    // or the friend just added vanished when a Refresh ended. Any other new
    // login is loaded next: onFriendsListChanged skips changes made while a
    // load runs, so nothing else would until the next page load.
    const added = state.friends.filter(
      (f) => keep.has(f.login) && !list.includes(f.login),
    );
    const adding = loginBeingAdded(state);
    arrived = [...keep].some(
      (l) =>
        !list.includes(l) &&
        l !== adding &&
        l !== state.addPending &&
        !added.some((f) => f.login === l),
    );
    state.friends = [
      ...result.friends.filter((f) => keep.has(f.login)),
      ...added,
    ];
    state.detailed = result.detail === "full";
    state.loadError = !result.ok;
    // Everyone answered, yet a saved login has no row: the Intra does not
    // know it. A failed load says nothing about the logins it missed.
    state.missingLogins = result.ok
      ? list.filter((l) => keep.has(l) && !result.friends.some((f) => f.login === l))
      : [];
    if (result.ok && result.fetchedAt !== null) state.lastFetch = result.fetchedAt;
    // A login saved while its check failed: it is checked now that it loaded.
    if (
      state.addPending &&
      state.friends.some((f) => f.login === state.addPending)
    ) {
      clearAddError(state);
    }
  } catch {
    if (current()) state.loadError = true;
  } finally {
    if (current()) {
      state.loading = false;
      renderWidgetUI();
      // The next load reads the list again and asks for what the panel needs
      // then, so it also stands for the completion below.
      if (arrived) void loadList(false);
      // Opened while the badge-only load ran: complete the rows now. Only
      // after an "online" load: a full one that fell back on old rows must
      // not start another.
      else if (requested === "online" && state.open && !state.detailed && !state.loadError)
        void loadList(false, "full");
    }
  }
}

/** The panel opened: rows from an "online" load still need their details. */
function completeOnOpen(state: WidgetState) {
  if (state.detailed || state.loading || state.notConnected || state.needsReconnect) return;
  void loadList(false, "full");
}

/**
 * The saved list changed outside the widget (the Add friend button on a
 * profile, another tab, a cloud pull): drop the rows that left and load the
 * logins that arrived. The widget's own writes are already in its state (or
 * are being checked), so they cost nothing here.
 */
function onFriendsListChanged(newList: string[]) {
  const state = _state;
  if (!state || state.notConnected || state.needsReconnect) return;
  const keep = new Set(newList);
  const before = state.friends.length + state.missingLogins.length;
  state.friends = state.friends.filter((f) => keep.has(f.login));
  state.missingLogins = state.missingLogins.filter((l) => keep.has(l));
  if (state.friends.length + state.missingLogins.length !== before) renderWidgetUI();
  if (state.loading || state.addLoading) return;
  const known = new Set([
    ...state.friends.map((f) => f.login),
    ...state.missingLogins,
    ...(state.addPending ? [state.addPending] : []),
  ]);
  if (newList.some((l) => !known.has(l))) void loadList(false);
}

function parseFriendsList(raw: unknown): string[] | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.every((l) => typeof l === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Check a login that is already saved in the list, and show the outcome.
 * Only a real "no such user" answer removes it again: an expired session, a
 * rate limit or a network error keeps it (and offers Retry), where it used to
 * be deleted with "User not found.".
 */
async function verifyAddedLogin(login: string) {
  const state = _state;
  if (!state) return;
  const wasPending = state.addPending === login;
  const check = await checkFriendLogin(login);
  if (state.needsReconnect) {
    state.needsReconnect = !!(await getConfig("CLOUD_AUTH_FAILED"));
  }
  state.addLoading = false;

  if (check.status === "not-found") {
    await removeFriend(login);
    state.addPending = null;
    state.addError = "User not found.";
    renderWidgetUI();
    // A pending login was saved and synced: the cloud copy must lose it too.
    if (wasPending) syncToCloud();
    return;
  }

  if (check.status === "error") {
    state.addPending = login;
    state.addError = `Could not check ${login} (Intra session expired or network error). It is saved: retry, or reload the page.`;
    state.addInput = "";
    renderWidgetUI();
    _shadow?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    syncToCloud();
    return;
  }

  if (!state.friends.some((f) => f.login === login)) {
    state.friends = [...state.friends, check.friend];
  }
  state.lastFetch = Date.now();
  state.addInput = "";
  state.missingLogins = state.missingLogins.filter((l) => l !== login);
  clearAddError(state);
  await cacheFriendData(check.friend);
  renderWidgetUI();
  _shadow?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
  syncToCloud();
}

export async function injectFriendsWidget() {
  if (_host) return;

  const show = await getConfig("SHOW_FRIENDS_WIDGET");
  if (!show) return;

  _host = document.createElement("div");
  _host.id = HOST_ID;
  document.body.appendChild(_host);
  _shadow = _host.attachShadow({ mode: "open" });
  bindTooltips(_shadow, getIsLight);

  // Escape closes the panel and gives focus back to the button that opens
  // it (the closed panel is inert, so focus inside it would be lost). The
  // add-login input handles its own Escape first and stops it.
  _shadow.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (ev.key !== "Escape" || ev.defaultPrevented || !_state?.open) return;
    closePanel(_state);
    renderWidgetUI();
    _shadow?.querySelector<HTMLButtonElement>(".friends-fab button")?.focus();
  });

  // the hub's theme toggle restyles the page live: the panel must follow
  themeUnfollow?.();
  _state = {
    ...(await loadInitialData()),
    onToggle: () => {
      if (!_state) return;
      if (_state.open) closePanel(_state);
      else _state.open = true;
      renderWidgetUI();
      if (_state.open) completeOnOpen(_state);
    },
    onRefresh: async () => {
      if (!_state || _state.notConnected) return;
      await loadList(true, "full");
      if (_state.needsReconnect) {
        _state.needsReconnect = !!(await getConfig("CLOUD_AUTH_FAILED"));
      }
      renderWidgetUI();
    },
    onSortChange: (mode: SortMode, dir: SortDir) => {
      if (!_state) return;
      _state.sortBy = mode;
      _state.sortDir = dir;
      chrome.storage.local.set({
        FRIENDS_SORT_MODE: mode,
        FRIENDS_SORT_DIR: dir,
      });
      renderWidgetUI();
    },
    onToggleOnline: () => {
      if (!_state) return;
      _state.onlineOnly = !_state.onlineOnly;
      chrome.storage.local.set({ FRIENDS_ONLINE_ONLY: _state.onlineOnly });
      renderWidgetUI();
    },
    onDeleteMode: () => {
      if (!_state) return;
      _state.deleteMode = !_state.deleteMode;
      _state.selected = [];
      _state.addOpen = false;
      renderWidgetUI();
    },
    onToggleSelect: (login: string) => {
      if (!_state) return;
      const idx = _state.selected.indexOf(login);
      if (idx >= 0) _state.selected.splice(idx, 1);
      else _state.selected.push(login);
      renderWidgetUI();
    },
    onConfirmDelete: async () => {
      if (!_state || _state.selected.length === 0) return;
      const n = _state.selected.length;
      if (
        !confirm(
          `Remove ${n} friend${n === 1 ? "" : "s"} from your friends list?`,
        )
      )
        return;
      for (const login of _state.selected) {
        await removeFriend(login);
      }
      const removed = new Set(_state.selected);
      _state.friends = _state.friends.filter((f) => !removed.has(f.login));
      _state.loadError = false;
      _state.deleteMode = false;
      _state.selected = [];
      renderWidgetUI();
      syncToCloud();
    },
    onCancelDelete: () => {
      if (!_state) return;
      _state.deleteMode = false;
      _state.selected = [];
      renderWidgetUI();
    },
    onInputChange: (val: string) => {
      if (!_state) return;
      _state.addInput = val;
      clearAddError(_state);
      renderWidgetUI();
    },
    onAdd: async () => {
      if (!_state || _state.notConnected) return;
      const login = _state.addInput.trim().toLowerCase();
      if (!login) return;

      _state.addLoading = true;
      clearAddError(_state);
      renderWidgetUI();

      if (await isFriend(login)) {
        _state.addError = "Already in your list.";
        _state.addLoading = false;
        renderWidgetUI();
        return;
      }

      // Saved before the check, so that a check that fails loses nothing.
      await addFriend(login);
      await verifyAddedLogin(login);
    },
    onRetryAdd: async () => {
      if (!_state || !_state.addPending || _state.addLoading) return;
      const login = _state.addPending;
      // Removed meanwhile (e.g. from their profile): nothing left to check.
      if (!(await isFriend(login))) {
        clearAddError(_state);
        renderWidgetUI();
        return;
      }
      _state.addLoading = true;
      renderWidgetUI();
      await verifyAddedLogin(login);
    },
    onCancelAdd: async () => {
      if (!_state || !_state.addPending || _state.addLoading) return;
      const login = _state.addPending;
      await removeFriend(login);
      _state.friends = _state.friends.filter((f) => f.login !== login);
      clearAddError(_state);
      renderWidgetUI();
      syncToCloud();
    },
    onRemoveMissing: async (login: string) => {
      if (!_state) return;
      await removeFriend(login);
      _state.missingLogins = _state.missingLogins.filter((l) => l !== login);
      renderWidgetUI();
      syncToCloud();
    },
    onToggleAdd: () => {
      if (!_state) return;
      _state.addOpen = !_state.addOpen;
      if (_state.addOpen) {
        _state.deleteMode = false;
        clearAddError(_state);
      } else {
        _state.addInput = "";
        clearAddError(_state);
      }
      renderWidgetUI();
      // Focus follows the form: into the input when it opens, back to the
      // "+" button when it closes (the control that had it is gone).
      _shadow
        ?.querySelector<HTMLElement>(
          _state.addOpen ? 'input[type="text"]' : 'button[aria-label="Add friend"]',
        )
        ?.focus();
    },
    onConnect: () => {
      loginWith42(async () => {
        if (_state) _state.needsReconnect = false;
        await clearAuthFailed();
        window.location.reload();
      });
    },
    onAvatarToggle: () => {
      renderWidgetUI();
    },
  };
  themeUnfollow = followTheme(_state, renderWidgetUI);

  renderWidgetUI();

  if (CLUSTERS.length === 0) {
    const campus = await getConfig("CLUSTERS_CAMPUS");
    // CLUSTERS only adds the #cluster-<id> hash to seat links, so it must not
    // hold the widget back: it used to be awaited before the host existed,
    // and a worker that was down (or a campus without a data file) kept the
    // widget off the page. An unknown campus is skipped: getClusterData("")
    // probes every campus file and loads the first one that exists.
    if (campus) {
      getClusterData(campus)
        .then(() => renderWidgetUI())
        .catch(() => {});
    }
  }

  // Before the first load, so that a friend removed while it runs loses the
  // row at once (loadList itself picks up the ones added meanwhile).
  // Optional chaining: a page with a partial chrome API shim has no onChanged.
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !("FRIENDS_LIST" in changes)) return;
    const list = parseFriendsList(changes.FRIENDS_LIST.newValue);
    if (list) onFriendsListChanged(list);
  });

  if (!_state.notConnected && !_state.needsReconnect) {
    await loadList(false);
  }

  renderWidgetUI();

  const closeOnOutsideClick = (e: Event) => {
    if (!_state || !_state.open) return;
    if (e.composedPath().includes(_host!)) return;
    closePanel(_state);
    renderWidgetUI();
  };
  document.addEventListener("click", closeOnOutsideClick);
}
