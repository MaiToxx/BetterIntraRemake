import {
  CLUSTERS_JSON_URL,
  POLL_INTERVAL,
  keyOf,
  clusterLabel,
  type ClusterInfo,
  type DialogState,
} from "./context";
import {
  renderActiveList,
  renderSeatOverlays,
  sortActiveUsers,
  type OccupancyEntry,
} from "./render";
import { normalizeSeatId } from "./seats";
import { applyActivePresence } from "./helpers";
import { applySeatGlow } from "./glow";
import { rebuildHeader } from "./header";
import { updateTabsOverflow } from "./tabs";
import { tickWhileVisible } from "../../../core/dom/dom-wait.ts";

type ClusterLoader = (state: DialogState, cluster: ClusterInfo) => void;

/**
 * Opens another cluster tab, for when the Active tab disappears under the
 * user. map-load.ts hands its loadCluster() over at start-up: it owns loading
 * a cluster and already imports this module to paint the occupancy, so
 * importing it back from here made the two modules a value import cycle.
 */
let switchToCluster: ClusterLoader | null = null;

export function registerClusterLoader(loader: ClusterLoader): void {
  switchToCluster = loader;
}

async function fetchOccupancy(
  campusId: string,
  signal?: AbortSignal,
): Promise<Map<string, OccupancyEntry> | null> {
  const url = campusId
    ? `https://meta.intra.42.fr/campus/${campusId}/clusters.json`
    : CLUSTERS_JSON_URL;
  // Returns null on failure (HTTP error, network error, abort). Returning an
  // empty map used to render a transient failure as "everyone left" and could
  // evict the user from the Active tab.
  try {
    const res = await fetch(url, {
      credentials: "include",
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, OccupancyEntry>;
    const map = new Map<string, OccupancyEntry>();
    for (const [, entry] of Object.entries(data)) {
      if (entry.host && entry.login) {
        map.set(entry.host, entry);
      }
    }
    return map;
  } catch {
    return null;
  }
}

export function applyOccupancy(
  state: DialogState,
  occupancy: Map<string, OccupancyEntry>,
) {
  const { shadow, activeCluster, activeCampusId } = state;
  state.wifiUsers = [];
  const workCopy = new Map(occupancy);
  for (const [host, entry] of workCopy) {
    if (host.startsWith("wifi-")) {
      state.wifiUsers.push(entry);
      workCopy.delete(host);
    }
  }
  state.activeUsers = sortActiveUsers(
    state.activeWifiOnly
      ? state.wifiUsers
      : [...workCopy.values(), ...state.wifiUsers],
    state.activeSortMode,
    state.activeNameDir,
    state.activeSinceDir,
  );
  state.seatedUsers = [...workCopy.values()];
  const activeVisible = state.activeUsers.length > 0;
  let clustersChanged = false;
  const activeChange = applyActivePresence(state.clusters, activeVisible);
  if (activeChange.added || activeChange.removed) {
    state.clusters = activeChange.clusters;
    clustersChanged = true;
  }
  if (clustersChanged) {
    rebuildHeader(state);
    if (activeChange.removed && activeCluster.id === "active") {
      // Only switch when there is a real cluster to switch to; leaving
      // activeCluster undefined made every later poll throw on `.id`.
      const next = state.clusters[0];
      if (next) {
        state.activeCluster = next;
        switchToCluster?.(state, next);
      }
    }
  }
  const positions = state.seatPosCache.get(
    keyOf(activeCampusId, activeCluster.id),
  );
  const viewBox = state.svgViewBoxes.get(
    keyOf(activeCampusId, activeCluster.id),
  );
  if (positions && viewBox) {
    renderSeatOverlays(shadow, workCopy, positions, viewBox);
  }
  if (activeCluster.id === "active") {
    renderActiveList(shadow, state.activeUsers);
  }
  if (state.flashingSeat) {
    applySeatGlow(state, state.flashingSeat);
  }
  const badge = shadow.getElementById("seat-count-badge");
  if (badge) {
    const total = positions?.size ?? 0;
    const taken = positions
      ? [...workCopy.keys()].filter((h) => positions.has(normalizeSeatId(h)))
          .length
      : 0;
    if (total > 0) {
      const free = total - taken;
      badge.textContent = `${taken} / ${total}`;
      badge.title = `${taken} taken, ${free} free · ${total} total`;
    } else {
      badge.textContent = `- / -`;
    }
  }
  const clusterCounts = new Map<string, { taken: number; total: number }>();
  const campusPrefix = `${activeCampusId}:`;
  for (const [key, seats] of state.seatPosCache) {
    if (!key.startsWith(campusPrefix)) continue;
    const clusterId = key.slice(campusPrefix.length);
    const taken = [...workCopy.keys()].filter((h) =>
      seats.has(normalizeSeatId(h)),
    ).length;
    clusterCounts.set(clusterId, { taken, total: seats.size });
  }
  for (const tab of shadow.querySelectorAll<HTMLElement>("[data-cluster-id]")) {
    const id = tab.dataset.clusterId;
    if (!id) continue;
    const cluster = state.clusters.find((c) => c.id === id);
    const name = cluster
      ? clusterLabel(cluster)
      : tab.dataset.clusterName || id.toUpperCase();
    tab.textContent = name;
    if (id === "active") {
      if (state.activeUsers.length > 0) {
        const num = document.createElement("span");
        num.textContent = `${state.activeUsers.length}`;
        num.style.cssText =
          "font-weight:400;opacity:0.55;font-size:11px;margin-left:6px;";
        tab.appendChild(num);
      }
      continue;
    }
    const count = clusterCounts.get(id);
    if (count && count.total > 0) {
      const num = document.createElement("span");
      num.textContent = `${count.taken}/${count.total}`;
      num.style.cssText =
        "font-weight:400;opacity:0.55;font-size:11px;margin-left:6px;";
      tab.appendChild(num);
    }
  }
  const clusterSelect = shadow.getElementById(
    "default-cluster-select",
  ) as HTMLSelectElement | null;
  if (clusterSelect) {
    for (const opt of clusterSelect.querySelectorAll("option")) {
      const cluster = state.clusters.find((c) => c.id === opt.value);
      if (cluster) opt.textContent = clusterLabel(cluster);
    }
  }
  const allCounts = [...clusterCounts.values()];
  const sumTaken = allCounts.reduce((s, c) => s + c.taken, 0);
  const sumTotal = allCounts.reduce((s, c) => s + c.total, 0);
  const totalsBadge = shadow.getElementById("totals-badge");
  if (totalsBadge) {
    if (activeCluster.id === "active") {
      totalsBadge.textContent = `${state.activeUsers.length} active`;
      totalsBadge.title = "Users currently connected";
      totalsBadge.style.display = state.activeUsers.length > 0 ? "" : "none";
    } else {
      totalsBadge.textContent = `${sumTaken} / ${sumTotal}`;
      totalsBadge.title = "Total taken / Total seats";
      if (sumTotal > 0 || sumTaken > 0) {
        totalsBadge.style.display = "";
      } else {
        totalsBadge.style.display = "none";
      }
    }
  }
  startCountdown(state);
  updateTabsOverflow(state);
}

export async function loadOccupancy(state: DialogState, signal?: AbortSignal) {
  const reloadIcon = state.shadow.getElementById("reload-icon");
  if (reloadIcon) reloadIcon.classList.add("spinning");
  try {
    const campusId = state.activeCampusId;
    const occupancy = await fetchOccupancy(campusId, signal);
    // Discard the result if the dialog was closed or the campus changed while
    // the request was in flight: host ids collide across campuses, so a late
    // answer for campus A would show A's occupants on B's map.
    if (signal?.aborted) return;
    if (campusId !== state.activeCampusId) return;
    if (occupancy === null) return; // fetch failed: keep the previous data
    state.occupancyCache = occupancy;
    state.lastUpdated = Date.now();
    applyOccupancy(state, occupancy);
  } finally {
    if (reloadIcon) reloadIcon.classList.remove("spinning");
  }
}

function updateBadge(state: DialogState) {
  const secs = Math.max(
    0,
    Math.ceil((POLL_INTERVAL - (Date.now() - state.lastUpdated)) / 1000),
  );
  const badgeText = state.shadow.getElementById("badge-text");
  if (badgeText) {
    badgeText.textContent = `${secs}s`;
  }
}

/** Stop functions of the running "next refresh in Ns" countdowns. */
const countdowns = new WeakMap<DialogState, () => void>();

function startCountdown(state: DialogState) {
  countdowns.get(state)?.();
  const badge = state.shadow.getElementById("updated-badge");
  if (badge) badge.style.display = "";
  updateBadge(state);
  // Derived from Date.now() and lastUpdated, so it can sleep in a background
  // tab and be right on the first tick back. It also dies with the dialog,
  // even when a late reapplyOccupancy() restarts it after the close.
  countdowns.set(
    state,
    tickWhileVisible(() => updateBadge(state), 1000, { element: state.dialog }),
  );
}

/** Stop the countdown badge (the dialog is closing). */
export function stopCountdown(state: DialogState): void {
  countdowns.get(state)?.();
  countdowns.delete(state);
}

/**
 * Refresh the occupancy every POLL_INTERVAL while the dialog is open and the
 * tab visible. Hidden, nothing is fetched; back in view, the cadence resumes
 * where it was, with one request right away if one fell due in between.
 * Stops when the dialog leaves the page or `signal` aborts. Returns a stop
 * function.
 */
export function startOccupancyPoll(
  state: DialogState,
  signal: AbortSignal,
): () => void {
  return tickWhileVisible(
    () => {
      if (signal.aborted) return true;
      void loadOccupancy(state, signal);
    },
    POLL_INTERVAL,
    { element: state.dialog, resyncOnVisible: false },
  );
}

export function reapplyOccupancy(state: DialogState) {
  if (!state.occupancyCache) return;
  applyOccupancy(state, state.occupancyCache);
}
