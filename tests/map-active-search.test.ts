/**
 * The cluster map's Active list says where each person sits, and a search box
 * filters it by login. The cards used to show an avatar, a login and "since
 * 2h", no seat: finding a teammate meant opening every cluster tab.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { DialogState } from "../src/features/clusters/map-dialog/context.ts";
import { applyOccupancy } from "../src/features/clusters/map-dialog/occupancy.ts";
import {
  ACTIVE_SORT_DEFAULT,
  filterActiveUsers,
  setMapFriends,
  type OccupancyEntry,
} from "../src/features/clusters/map-dialog/render.ts";
import {
  activeSearchTarget,
  handleActiveSearchKey,
  setActiveQuery,
} from "../src/features/clusters/map-dialog/active-sort.ts";
import { jumpToSeat } from "../src/features/clusters/map-dialog/map-load.ts";

const MAP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="e1r1s1" x="0" y="0" width="10" height="10"/><rect id="e1r1s2" x="20" y="0" width="10" height="10"/></svg>';

function state(): DialogState {
  const dialog = document.createElement("dialog");
  const host = document.createElement("div");
  dialog.appendChild(host);
  document.body.appendChild(dialog);
  const shadow = host.attachShadow({ mode: "open" });
  for (const id of ["map-area", "totals-badge", "active-search-status"]) {
    const el = document.createElement("div");
    el.id = id;
    shadow.appendChild(el);
  }
  const tab = document.createElement("button");
  tab.dataset.clusterId = "active";
  shadow.appendChild(tab);
  return {
    shadow,
    dialog,
    tabsState: { wired: new WeakSet(), overflowing: false, resizeObserver: null },
    timers: { poll: null, clock: null, countdown: null },
    campusOptions: [{ id: "1", name: "Paris", timezone: "Europe/Paris" }],
    activeCampusId: "1",
    detectedCampus: "1",
    currentTheme: "dark",
    // e1 has a map; e2 is listed by the campus file but has none
    clusters: [
      { id: "e1", name: "e1", svg: "https://cdn.intra.42.fr/cluster/image/1/e1.svg" },
      { id: "e2", name: "e2" },
    ],
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
    activeWifiOnly: false,
    activeQuery: "",
  } as DialogState;
}

const entry = (login: string, host: string): [string, OccupancyEntry] => [
  host,
  { host, login, cdn_uri: "", begin_at: "2026-09-24T08:00:00Z", end_at: null },
];

/** alice on a mapped seat, bob on Wi-Fi, carol on a cluster with no map. */
const occupancy = () =>
  new Map([
    entry("alice", "e1r1s1"),
    entry("bob", "wifi-12ab"),
    entry("carol", "e2r3s4"),
  ]);

const mapArea = (s: DialogState) => s.shadow.getElementById("map-area")!;
const cards = (s: DialogState) => [...mapArea(s).querySelectorAll<HTMLElement>(".active-card")];
const loginsShown = (s: DialogState) =>
  cards(s).map((c) => c.querySelector(".active-card-login")!.textContent);

afterEach(() => {
  document.body.replaceChildren();
  setMapFriends([]);
});

describe("the seat on each Active card", () => {
  it("is a button that opens the map when the seat's cluster has one", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    const card = cards(s).find((c) => c.textContent!.includes("alice"))!;
    const chip = card.querySelector<HTMLButtonElement>("button.seat-chip")!;
    expect(chip.textContent).toBe("e1r1s1");
    expect(chip.dataset.jumpSeat).toBe("e1r1s1");
    expect(chip.type).toBe("button");
    expect(chip.getAttribute("aria-label")).toBe("View e1r1s1 on cluster map");
    // next to the profile link, not inside it
    expect(chip.closest("a")).toBeNull();
    expect(card.querySelector("a")!.getAttribute("href")).toContain("/users/alice");
  });

  it("says Wi-Fi for a Wi-Fi host, as plain text", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    const card = cards(s).find((c) => c.textContent!.includes("bob"))!;
    expect(card.querySelector("button")).toBeNull();
    expect(card.querySelector(".seat-chip")!.textContent).toBe("Wi-Fi");
  });

  it("shows a seat on no map as text, so it does not look like a link", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    const card = cards(s).find((c) => c.textContent!.includes("carol"))!;
    expect(card.querySelector("button")).toBeNull();
    expect(card.querySelector(".seat-chip")!.textContent).toBe("e2r3s4");
  });

  it("keeps a keyboard user's place when the poll redraws the list", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    s.shadow.querySelector<HTMLElement>('[data-jump-seat="e1r1s1"]')!.focus();
    applyOccupancy(s, occupancy());
    const chip = s.shadow.activeElement as HTMLElement;
    expect(chip.dataset.jumpSeat).toBe("e1r1s1");
    expect(chip.isConnected).toBe(true);
    const bob = cards(s).find((c) => c.textContent!.includes("bob"))!;
    bob.querySelector<HTMLElement>(".active-card-link")!.focus();
    applyOccupancy(s, occupancy());
    const link = s.shadow.activeElement as HTMLAnchorElement;
    expect(link.isConnected).toBe(true);
    expect(link.getAttribute("href")).toContain("/users/bob");
  });

  it("keeps friends marked on the card", () => {
    setMapFriends(["carol"]);
    const s = state();
    applyOccupancy(s, occupancy());
    const first = cards(s)[0];
    expect(first.dataset.friend).toBe("true");
    expect(first.textContent).toContain("★ carol");
  });
});

describe("the Active search box", () => {
  it("filters by login, whatever the case", () => {
    expect(filterActiveUsers([...occupancy().values()], " AL ").map((u) => u.login)).toEqual([
      "alice",
    ]);
    expect(filterActiveUsers([...occupancy().values()], "")).toHaveLength(3);
  });

  it("filters the list while the tab and the badge still count everyone", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    setActiveQuery(s, "ca");
    expect(loginsShown(s)).toEqual(["carol"]);
    expect(s.activeUsers).toHaveLength(3);
    applyOccupancy(s, occupancy());
    expect(s.shadow.getElementById("totals-badge")!.textContent).toBe("3 active");
    expect(s.shadow.querySelector("[data-cluster-id='active']")!.textContent).toContain("3");
  });

  it("survives the 60 s poll, which rebuilds the list", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    setActiveQuery(s, "ali");
    applyOccupancy(s, new Map([...occupancy(), entry("alina", "e1r1s2")]));
    expect(loginsShown(s)).toEqual(["alice", "alina"]);
  });

  it("says when no login matches, and counts the matches for screen readers", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    const status = s.shadow.getElementById("active-search-status")!;
    expect(status.textContent).toBe("");
    setActiveQuery(s, "zed");
    expect(mapArea(s).textContent).toBe("No login matches “zed”");
    expect(status.textContent).toBe("0 matches");
    setActiveQuery(s, "a");
    expect(status.textContent).toBe("2 matches");
    setActiveQuery(s, "");
    expect(status.textContent).toBe("");
    expect(cards(s)).toHaveLength(3);
  });

  it("keeps the regular empty state when nobody is there at all", () => {
    const s = state();
    s.activeWifiOnly = true;
    applyOccupancy(s, new Map([entry("alice", "e1r1s1")]));
    setActiveQuery(s, "ali");
    expect(mapArea(s).textContent).toBe("No one on Wi-Fi right now");
  });

  it("Enter opens the seat of a single match that has a map, and only then", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    const box = document.createElement("input");
    const jumps: string[] = [];
    const press = (key: string) => {
      const e = new KeyboardEvent("keydown", { key, cancelable: true });
      handleActiveSearchKey(s, box, e, (seat) => jumps.push(seat));
      return e;
    };
    setActiveQuery(s, "a"); // alice and carol
    expect(activeSearchTarget(s)).toBeNull();
    press("Enter");
    setActiveQuery(s, "bob"); // Wi-Fi
    press("Enter");
    setActiveQuery(s, "carol"); // no map
    press("Enter");
    expect(jumps).toEqual([]);
    setActiveQuery(s, "alice");
    expect(press("Enter").defaultPrevented).toBe(true);
    expect(jumps).toEqual(["e1r1s1"]);
  });

  it("leaves an input method's Enter and Escape to the text it composes", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    const box = document.createElement("input");
    box.value = "alice";
    setActiveQuery(s, box.value);
    const jumps: string[] = [];
    for (const key of ["Enter", "Escape"]) {
      const e = new KeyboardEvent("keydown", { key, isComposing: true, cancelable: true });
      handleActiveSearchKey(s, box, e, (seat) => jumps.push(seat));
      expect(e.defaultPrevented).toBe(false);
    }
    expect(jumps).toEqual([]);
    expect(box.value).toBe("alice");
  });

  it("Escape empties a filled box without closing the dialog, then closes it", () => {
    const s = state();
    applyOccupancy(s, occupancy());
    const box = document.createElement("input");
    box.value = "ali";
    setActiveQuery(s, box.value);
    const first = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    handleActiveSearchKey(s, box, first, () => {});
    expect(first.defaultPrevented).toBe(true);
    expect(box.value).toBe("");
    expect(cards(s)).toHaveLength(3);
    const second = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    handleActiveSearchKey(s, box, second, () => {});
    expect(second.defaultPrevented).toBe(false);
  });
});

describe("jumping to a seat", () => {
  // jsdom lays nothing out and has no scrollIntoView on SVG elements
  Element.prototype.scrollIntoView ??= () => {};

  function withMap(s: DialogState) {
    const doc = new DOMParser().parseFromString(MAP_SVG, "image/svg+xml");
    s.parsedDocs.set("1:e1", doc);
    s.seatPosCache.set("1:e1", new Map([["e1r1s1", { x: 0, y: 0, w: 10, h: 10 }]]));
    s.svgViewBoxes.set("1:e1", { w: 100, h: 100 });
  }

  it("opens the seat's cluster and makes the seat glow", async () => {
    const s = state();
    withMap(s);
    applyOccupancy(s, occupancy());
    await jumpToSeat(s, "e1r1s1");
    expect(s.activeCluster.id).toBe("e1");
    const seat = mapArea(s).querySelector("#e1r1s1")!;
    expect(seat.classList.contains("ft-dialog-seat-glow")).toBe(true);
    expect(s.flashingSeat).toBe("e1r1s1");
  });

  it("stays on the Active list for a seat with no map", async () => {
    const s = state();
    withMap(s);
    applyOccupancy(s, occupancy());
    await jumpToSeat(s, "e2r3s4");
    await jumpToSeat(s, "wifi-12ab");
    expect(s.activeCluster.id).toBe("active");
    expect(cards(s)).toHaveLength(3);
  });

  it("does nothing once the dialog closed during the load", async () => {
    const s = state();
    withMap(s);
    applyOccupancy(s, occupancy());
    const ctrl = new AbortController();
    const pending = jumpToSeat(s, "e1r1s1", ctrl.signal);
    ctrl.abort();
    await pending;
    expect(s.flashingSeat).toBeNull();
  });
});
