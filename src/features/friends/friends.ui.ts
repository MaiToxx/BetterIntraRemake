/**
 * Entry point of the friends widget: mounts its shadow host on the page, owns
 * the one live WidgetState and wires every control to what it does (fetching,
 * adding and removing friends, persisting sort and filter choices, reconnect).
 * The markup lives in friends-panel.ts and the modules it pulls in.
 */
import { render } from "lit-html";
import {
  addFriend,
  clearFriendsCache,
  fetchFriendsData,
  getFriendsList,
  isFriend,
  removeFriend,
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
import { loadInitialData, type WidgetState } from "./friends-widget-state.ts";
import { renderWidget } from "./friends-panel.ts";
import { debugRowAlignment } from "./friends-list.ts";

const HOST_ID = "friends-widget-host";

let _host: HTMLElement | null = null;
let _shadow: ShadowRoot | null = null;
let _state: WidgetState | null = null;
function renderWidgetUI() {
  if (_state && _shadow) render(renderWidget(_state), _shadow);
  debugRowAlignment(_shadow);
}

export async function injectFriendsWidget() {
  if (_host) return;

  const show = await getConfig("SHOW_FRIENDS_WIDGET");
  if (!show) return;

  if (CLUSTERS.length === 0) {
    const campus = await getConfig("CLUSTERS_CAMPUS");
    await getClusterData(campus);
  }

  _host = document.createElement("div");
  _host.id = HOST_ID;
  document.body.appendChild(_host);
  _shadow = _host.attachShadow({ mode: "open" });
  bindTooltips(_shadow, getIsLight);

  _state = {
    ...(await loadInitialData()),
    onToggle: () => {
      if (!_state) return;
      _state.open = !_state.open;
      if (!_state.open) {
        _state.deleteMode = false;
        _state.selected = [];
        _state.addOpen = false;
      }
      renderWidgetUI();
    },
    onRefresh: async () => {
      if (!_state || _state.notConnected) return;
      _state.loading = true;
      _state.loadError = false;
      renderWidgetUI();
      clearFriendsCache();
      const list = await getFriendsList();
      _state.friends = await fetchFriendsData(list);
      _state.loadError = list.length > 0 && _state.friends.length === 0;
      _state.lastFetch = Date.now();
      _state.loading = false;
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
      _state.addError = "";
      renderWidgetUI();
    },
    onAdd: async () => {
      if (!_state || _state.notConnected) return;
      const login = _state.addInput.trim().toLowerCase();
      if (!login) return;

      _state.addLoading = true;
      _state.addError = "";
      renderWidgetUI();

      if (await isFriend(login)) {
        _state.addError = "Already in your list.";
        _state.addLoading = false;
        renderWidgetUI();
        return;
      }

      await addFriend(login);

      const fresh = await fetchFriendsData([login]);
      if (_state.needsReconnect) {
        _state.needsReconnect = !!(await getConfig("CLOUD_AUTH_FAILED"));
      }
      if (fresh.length === 0) {
        await removeFriend(login);
        _state.addError = "User not found.";
        _state.addLoading = false;
        renderWidgetUI();
        return;
      }

      _state.friends = [..._state.friends, ...fresh];
      _state.lastFetch = Date.now();
      _state.addInput = "";
      _state.addLoading = false;
      clearFriendsCache();
      renderWidgetUI();
      _shadow?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      syncToCloud();
    },
    onToggleAdd: () => {
      if (!_state) return;
      _state.addOpen = !_state.addOpen;
      if (_state.addOpen) {
        _state.deleteMode = false;
        _state.addError = "";
      } else {
        _state.addInput = "";
        _state.addError = "";
      }
      renderWidgetUI();
      if (_state.addOpen) {
        _shadow?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      }
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

  renderWidgetUI();

  if (!_state.notConnected && !_state.needsReconnect) {
    _state.loading = true;
    _state.loadError = false;
    renderWidgetUI();
    const list = await getFriendsList();
    _state.friends = await fetchFriendsData(list);
    _state.loadError = list.length > 0 && _state.friends.length === 0;
    _state.lastFetch = Date.now();
    _state.loading = false;
  }

  renderWidgetUI();

  const closeOnOutsideClick = (e: Event) => {
    if (!_state || !_state.open) return;
    if (e.composedPath().includes(_host!)) return;
    _state.open = false;
    _state.deleteMode = false;
    _state.selected = [];
    _state.addOpen = false;
    renderWidgetUI();
  };
  document.addEventListener("click", closeOnOutsideClick);
}
