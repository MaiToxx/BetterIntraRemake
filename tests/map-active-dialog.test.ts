/**
 * The Active list's seat buttons and search box, wired in the real dialog:
 * a click on a seat opens its cluster with the seat glowing and focus on it
 * (or on the cluster's tab when the seat has no avatar over it), typing
 * filters the list, Enter on a single match jumps, Escape empties the box
 * before it closes anything, and the dialog's host tells the page-wide key
 * listener (the easter eggs) that a field has focus: the root is closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nothing } from "lit-html";

vi.mock("../src/core/styles/shared-styles.ts", () => ({
  sharedStylesLink: () => nothing,
  adoptSharedStyles: () => {},
}));
vi.mock("../src/core/theme/theme-manager.ts", () => ({
  getEffectiveTheme: async () => "dark",
  getIsLight: () => false,
  onThemeChange: () => () => {},
}));
vi.mock("../src/core/dom/resizable-dialog.ts", () => ({
  makeResizable: () => () => {},
}));
vi.mock("../src/core/config.ts", () => ({
  getConfig: async (key: string) => {
    if (key === "CLUSTERS_CAMPUS") return "48";
    if (key === "CLUSTERS_DEFAULT_ID") return "active";
    if (key === "CLUSTERS_SHOW_MARKERS") return false;
    if (key === "PROFILE_THEME_PRESET") return "dark";
    return undefined;
  },
}));
vi.mock("../src/features/clusters/clusters.data.ts", () => ({
  fetchCampusList: async () => ({ campuses: [{ id: "48", name: "Mulhouse" }] }),
  getClusterData: async () => ({ clusters: [{ id: "e1", name: "e1" }] }),
  getCampusExits: async () => undefined,
  hasMarkerDefinitions: () => false,
  SCREENS: {},
  CLUSTERS: [],
}));

const { openClusterDialog } = await import("../src/features/clusters/map-dialog.ts");

const SVG_URL = "https://cdn.intra.42.fr/cluster/image/1/e1.svg";
const MAP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="e1r1s1" x="0" y="0" width="10" height="10"/><rect id="e1r1s2" x="20" y="0" width="10" height="10"/></svg>';
const CAMPUS_PAGE = `<div class="tab-pane" id="cluster-e1"><div class="map-container" data-image="${SVG_URL}"></div></div>`;
const since = "2026-09-24T08:00:00Z";
const OCCUPANCY = {
  1: { host: "e1r1s1", login: "alice", cdn_uri: "", begin_at: since, end_at: null },
  2: { host: "wifi-12ab", login: "bob", cdn_uri: "", begin_at: since, end_at: null },
  3: { host: "e1r1s2", login: "carol", cdn_uri: "", begin_at: since, end_at: null },
};

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
}

let shadowRoots: ShadowRoot[] = [];
const realAttach = Element.prototype.attachShadow;

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.body.replaceChildren();
  shadowRoots = [];
  // The dialog's root is closed: keep a handle to look inside it.
  Element.prototype.attachShadow = function (init) {
    const root = realAttach.call(this, init);
    shadowRoots.push(root);
    return root;
  };
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // jsdom's frames never fire without a visual: loadCluster() waits on two
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 0),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/campus/48/clusters.json")) return Response.json(OCCUPANCY);
      if (url.includes("/campus/48/clusters")) return new Response(CAMPUS_PAGE);
      if (url.includes("/api/v1/cluster/svg")) return new Response(MAP_SVG);
      return new Response("", { status: 404 });
    }),
  );
});

afterEach(() => {
  document.getElementById("cluster-map-dialog")?.remove();
  Element.prototype.attachShadow = realAttach;
  vi.unstubAllGlobals();
});

async function openOnActive() {
  void openClusterDialog();
  await settle();
  const shadow = shadowRoots.find((r) => r.getElementById("map-area"))!;
  const host = shadow.host as HTMLElement;
  const box = shadow.getElementById("active-search") as HTMLInputElement;
  const logins = () =>
    [...shadow.querySelectorAll(".active-card-login")].map((el) => el.textContent);
  return { shadow, host, box, logins };
}

function type(box: HTMLInputElement, value: string) {
  box.value = value;
  box.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function press(box: HTMLInputElement, key: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true });
  box.dispatchEvent(e);
  return e;
}

describe("the Active list in the map dialog", () => {
  it("opens a seat's cluster from its button, the seat glowing and focused", async () => {
    const { shadow, logins } = await openOnActive();
    expect(logins()).toEqual(["alice", "bob", "carol"]);
    shadow.querySelector<HTMLButtonElement>('button[data-jump-seat="e1r1s1"]')!.click();
    await settle();
    const seat = shadow.getElementById("map-area")!.querySelector("#e1r1s1")!;
    expect(seat.classList.contains("ft-dialog-seat-glow")).toBe(true);
    // jsdom lays nothing out, so no avatar link covers the seat: the tab
    // takes the focus the removed button had
    const focused = shadow.activeElement as HTMLElement | null;
    expect(focused?.dataset.clusterId).toBe("e1");
  });

  it("filters as you type, and Enter on a single match opens the seat", async () => {
    const { shadow, box, logins } = await openOnActive();
    type(box, "CAR");
    expect(logins()).toEqual(["carol"]);
    expect(shadow.getElementById("active-search-status")!.textContent).toBe("1 match");
    expect(press(box, "Enter").defaultPrevented).toBe(true);
    await settle();
    const seat = shadow.getElementById("map-area")!.querySelector("#e1r1s2")!;
    expect(seat.classList.contains("ft-dialog-seat-glow")).toBe(true);
  });

  it("Escape empties a filled box and leaves the dialog open", async () => {
    const { box, logins } = await openOnActive();
    type(box, "ali");
    const e = press(box, "Escape");
    expect(e.defaultPrevented).toBe(true);
    expect(box.value).toBe("");
    expect(logins()).toEqual(["alice", "bob", "carol"]);
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    // an empty box lets Escape reach the dialog, which closes
    expect(press(box, "Escape").defaultPrevented).toBe(false);
  });

  it("marks the closed root's host while one of its fields has focus", async () => {
    const { shadow, host, box } = await openOnActive();
    expect(host.dataset.ftTyping).toBeUndefined();
    box.focus();
    expect(host.dataset.ftTyping).toBe("");
    box.blur();
    expect(host.dataset.ftTyping).toBeUndefined();
    // the default cluster select types to pick an option, eggs' rule too
    const select = shadow.getElementById("default-cluster-select") as HTMLSelectElement;
    select.focus();
    expect(host.dataset.ftTyping).toBe("");
    select.blur();
    expect(host.dataset.ftTyping).toBeUndefined();
  });
});
