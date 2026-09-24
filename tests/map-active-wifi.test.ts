/**
 * The cluster map's Active tab and its "Wi-Fi only" switch, which lives in
 * that tab. The tab used to exist only while the FILTERED list had someone:
 * Wi-Fi only with nobody on Wi-Fi removed the tab, the switch with it, and
 * the saved choice kept it gone.
 */
import { describe, it, expect } from "vitest";
import type { DialogState } from "../src/features/clusters/map-dialog/context.ts";
import { applyOccupancy } from "../src/features/clusters/map-dialog/occupancy.ts";
import { ACTIVE_SORT_DEFAULT, type OccupancyEntry } from "../src/features/clusters/map-dialog/render.ts";

function state(wifiOnly: boolean): DialogState {
  const dialog = document.createElement("dialog");
  const host = document.createElement("div");
  dialog.appendChild(host);
  document.body.appendChild(dialog);
  const shadow = host.attachShadow({ mode: "open" });
  const mapArea = document.createElement("div");
  mapArea.id = "map-area";
  shadow.appendChild(mapArea);
  return {
    shadow,
    dialog,
    tabsState: { wired: new WeakSet(), overflowing: false, resizeObserver: null },
    timers: { poll: null, clock: null, countdown: null },
    campusOptions: [{ id: "1", name: "Paris", timezone: "Europe/Paris" }],
    activeCampusId: "1",
    detectedCampus: "1",
    currentTheme: "dark",
    clusters: [{ id: "e1", name: "e1" }],
    activeCluster: { id: "active", name: "Active" },
    defaultId: "e1",
    campusExits: null,
    zoomLevel: 1,
    defaultZoomLevel: 1,
    showMarkers: false,
    seatPosCache: new Map(),
    svgViewBoxes: new Map(),
    parsedDocs: new Map(),
    loadId: 0,
    retryCount: 0,
    lastUpdated: Date.now(),
    occupancyCache: null,
    wifiUsers: [],
    seatedUsers: [],
    activeUsers: [],
    flashingSeat: null,
    activeSortMode: ACTIVE_SORT_DEFAULT.mode,
    activeNameDir: ACTIVE_SORT_DEFAULT.nameDir,
    activeSinceDir: ACTIVE_SORT_DEFAULT.sinceDir,
    activeWifiOnly: wifiOnly,
  } as DialogState;
}

const seated = (login: string): [string, OccupancyEntry] => [
  "e1r1s1",
  { host: "e1r1s1", login, cdn_uri: "", begin_at: "2026-09-24T08:00:00Z", end_at: null },
];

describe("the Active tab under the Wi-Fi filter", () => {
  it("stays while someone is seated, with an empty state that names the filter", () => {
    const s = state(true);
    applyOccupancy(s, new Map([seated("alice")]));
    expect(s.activeUsers).toEqual([]);
    expect(s.clusters.some((c) => c.id === "active")).toBe(true);
    expect(s.shadow.getElementById("map-area")!.textContent).toContain("No one on Wi-Fi right now");
  });

  it("goes when nobody at all is active", () => {
    const s = state(false);
    applyOccupancy(s, new Map([seated("alice")]));
    expect(s.clusters.some((c) => c.id === "active")).toBe(true);
    applyOccupancy(s, new Map());
    expect(s.clusters.some((c) => c.id === "active")).toBe(false);
  });
});

describe("friends on the map", () => {
  it("come first in the Active list, whatever the sort, and are marked", async () => {
    const { setMapFriends, sortActiveUsers, renderActiveList } = await import(
      "../src/features/clusters/map-dialog/render.ts"
    );
    const entry = (login: string, begin: string): OccupancyEntry => ({
      host: login, login, cdn_uri: "", begin_at: begin, end_at: null,
    });
    const list = [entry("alice", "2026-09-24T08:00:00Z"), entry("zed", "2026-09-24T09:00:00Z"), entry("bob", "2026-09-24T07:00:00Z")];
    setMapFriends(["Zed", 42 as unknown as string]);
    expect(sortActiveUsers(list, "name", "asc", "asc").map((u) => u.login)).toEqual(["zed", "alice", "bob"]);
    expect(sortActiveUsers(list, "since", "asc", "asc").map((u) => u.login)).toEqual(["zed", "bob", "alice"]);
    const s = state(false);
    s.activeUsers = sortActiveUsers(list, "name", "asc", "asc");
    renderActiveList(s);
    const cards = [...s.shadow.querySelectorAll<HTMLElement>("#map-area .active-card")];
    expect(cards[0].dataset.friend).toBe("true");
    expect(cards[0].textContent).toContain("★ zed");
    expect(cards[1].dataset.friend).toBeUndefined();
    setMapFriends([]);
  });
});
