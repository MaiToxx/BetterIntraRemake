import { render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { DialogState } from "./context";
import {
  filterActiveUsers,
  renderActiveList,
  sortActiveUsers,
  type ActiveSortMode,
} from "./render";
import { seatCluster } from "./helpers";
import { t } from "../../../core/i18n/i18n.ts";
import SORT_AZ_SVG from "../../../assets/svg/sort-az.svg?raw";
import SORT_ZA_SVG from "../../../assets/svg/sort-za.svg?raw";
import CAL_DOWN_SVG from "../../../assets/svg/calendar-arrow-down.svg?raw";
import CAL_UP_SVG from "../../../assets/svg/calendar-arrow-up.svg?raw";

export function persistActiveSort(state: DialogState) {
  chrome.storage.local.set({
    MAP_ACTIVE_SORT: {
      mode: state.activeSortMode,
      nameDir: state.activeNameDir,
      sinceDir: state.activeSinceDir,
    },
  });
}

export function updateActiveSortControls(state: DialogState) {
  const {
    shadow,
    activeSortMode,
    activeNameDir,
    activeSinceDir,
    activeWifiOnly,
  } = state;
  const nameBtn = shadow.getElementById("sort-name");
  const sinceBtn = shadow.getElementById("sort-since");
  if (nameBtn) {
    const icon = nameBtn.querySelector<HTMLElement>(".sort-icon");
    if (icon) {
      render(
        unsafeHTML(
          (activeNameDir === "asc" ? SORT_AZ_SVG : SORT_ZA_SVG).replace(
            "<svg",
            '<svg width="14" height="14"',
          ),
        ),
        icon,
      );
    }
    nameBtn.style.opacity = activeSortMode === "name" ? "1" : "0.45";
    nameBtn.style.fontWeight = activeSortMode === "name" ? "700" : "";
    nameBtn.dataset.tip =
      activeSortMode === "name"
        ? activeNameDir === "asc"
          ? t("Name A → Z (click to invert)")
          : t("Name Z → A (click to invert)")
        : t("Sort by login");
    nameBtn.setAttribute("aria-label", nameBtn.dataset.tip);
    nameBtn.setAttribute("aria-pressed", String(activeSortMode === "name"));
  }
  if (sinceBtn) {
    const icon = sinceBtn.querySelector<HTMLElement>(".sort-icon");
    if (icon) {
      render(
        unsafeHTML(
          (activeSinceDir === "desc" ? CAL_DOWN_SVG : CAL_UP_SVG).replace(
            "<svg",
            '<svg width="14" height="14"',
          ),
        ),
        icon,
      );
    }
    sinceBtn.style.opacity = activeSortMode === "since" ? "1" : "0.45";
    sinceBtn.style.fontWeight = activeSortMode === "since" ? "700" : "";
    sinceBtn.dataset.tip =
      activeSortMode === "since"
        ? activeSinceDir === "desc"
          ? t("Newest first (click to invert)")
          : t("Oldest first (click to invert)")
        : t("Sort by connection time");
    sinceBtn.setAttribute("aria-label", sinceBtn.dataset.tip);
    sinceBtn.setAttribute("aria-pressed", String(activeSortMode === "since"));
  }
  const wifiBtn = shadow.getElementById("active-wifi-toggle");
  if (wifiBtn) {
    wifiBtn.setAttribute("aria-pressed", String(activeWifiOnly));
    wifiBtn.style.opacity = activeWifiOnly ? "1" : "0.45";
    wifiBtn.style.fontWeight = activeWifiOnly ? "700" : "";
    wifiBtn.dataset.tip = t(
      activeWifiOnly
        ? "Showing only Wi-Fi users (click to show all)"
        : "Show only Wi-Fi users",
    );
  }
}

export function toggleActiveWifi(state: DialogState) {
  const { activeCluster } = state;
  state.activeWifiOnly = !state.activeWifiOnly;
  chrome.storage.local.set({
    MAP_ACTIVE_WIFI: state.activeWifiOnly,
  });
  state.activeUsers = sortActiveUsers(
    state.activeWifiOnly
      ? state.wifiUsers
      : [...state.seatedUsers, ...state.wifiUsers],
    state.activeSortMode,
    state.activeNameDir,
    state.activeSinceDir,
  );
  if (activeCluster.id === "active") renderActiveList(state);
  updateActiveSortControls(state);
}

/** The search box changed: the Active list shows the logins that contain it. */
export function setActiveQuery(state: DialogState, query: string) {
  state.activeQuery = query;
  if (state.activeCluster.id === "active") renderActiveList(state);
}

/**
 * The seat Enter in the search box opens: the search leaves exactly one
 * person and their seat is on a map. null otherwise (Wi-Fi, no map, or
 * several matches, where Enter does nothing).
 */
export function activeSearchTarget(state: DialogState): string | null {
  const users = filterActiveUsers(state.activeUsers, state.activeQuery);
  if (users.length !== 1) return null;
  const { host } = users[0];
  if (host.startsWith("wifi-")) return null;
  return seatCluster(state.clusters, host) ? host : null;
}

/**
 * A key in the search box. Enter on a search that leaves one person opens
 * their seat with `jump`. Escape empties a filled box and stops there; once
 * the box is empty it closes the dialog, as it does everywhere else in it.
 */
export function handleActiveSearchKey(
  state: DialogState,
  box: HTMLInputElement,
  e: KeyboardEvent,
  jump: (seat: string) => void,
) {
  // An input method's Enter or Escape belongs to the text being composed.
  if (e.isComposing) return;
  if (e.key === "Escape" && box.value) {
    e.preventDefault();
    e.stopPropagation();
    box.value = "";
    setActiveQuery(state, "");
  } else if (e.key === "Enter") {
    const seat = activeSearchTarget(state);
    if (seat) {
      e.preventDefault();
      jump(seat);
    }
  }
}

export function toggleActiveSort(state: DialogState, mode: ActiveSortMode) {
  const { activeCluster } = state;
  if (state.activeSortMode === mode) {
    if (mode === "name") {
      state.activeNameDir = state.activeNameDir === "asc" ? "desc" : "asc";
    } else {
      state.activeSinceDir = state.activeSinceDir === "desc" ? "asc" : "desc";
    }
  } else {
    state.activeSortMode = mode;
  }
  persistActiveSort(state);
  state.activeUsers = sortActiveUsers(
    state.activeUsers,
    state.activeSortMode,
    state.activeNameDir,
    state.activeSinceDir,
  );
  if (activeCluster.id === "active") renderActiveList(state);
  updateActiveSortControls(state);
}
