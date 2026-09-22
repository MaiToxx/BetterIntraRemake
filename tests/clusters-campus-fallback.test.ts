/**
 * The map dialog for a student whose campus is not known yet (first visit is
 * a /users/ page, which does not announce it) or has no data file: it used to
 * open on Abu Dhabi, the first name of the sorted campus list, and an SVG
 * that could not be fetched left an empty pane. Now the viewer's own campus
 * (what meta.intra.42.fr answers with no id), a named empty state and a
 * "Failed to load map" block with Retry.
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

const config = vi.hoisted(() => ({ CLUSTERS_CAMPUS: "" as string }));
vi.mock("../src/core/config.ts", () => ({
  getConfig: async (key: string) => {
    if (key === "CLUSTERS_CAMPUS") return config.CLUSTERS_CAMPUS;
    if (key === "CLUSTERS_DEFAULT_ID") return "";
    if (key === "CLUSTERS_SHOW_MARKERS") return false;
    if (key === "PROFILE_THEME_PRESET") return "dark";
    return undefined;
  },
}));

const MANIFEST = {
  campuses: [
    { id: "43", name: "Abu Dhabi" },
    { id: "48", name: "Mulhouse" },
  ],
};
const getClusterData = vi.hoisted(() => vi.fn());
const getCampusExits = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/features/clusters/clusters.data.ts", () => ({
  fetchCampusList: async () => MANIFEST,
  getClusterData,
  getCampusExits,
  hasMarkerDefinitions: () => false,
  SCREENS: {},
  CLUSTERS: [],
}));

const { buildClusters, renderNoClusterData, renderMapError, loadCluster } =
  await import("../src/features/clusters/map-dialog/map-load.ts");
const { campusDisplayName } = await import(
  "../src/features/clusters/map-dialog/helpers.ts"
);
const { openClusterDialog } = await import("../src/features/clusters/map-dialog.ts");
type DialogState = import("../src/features/clusters/map-dialog/context.ts").DialogState;

/** Resolves the awaits of an opening dialog. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

function stateWithMap(): { state: DialogState; mapArea: HTMLElement } {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const mapArea = document.createElement("div");
  mapArea.id = "map-area";
  shadow.appendChild(mapArea);
  const state = {
    shadow,
    campusOptions: MANIFEST.campuses,
    activeCampusId: "",
    clusters: [],
    seatPosCache: new Map(),
    svgViewBoxes: new Map(),
    parsedDocs: new Map(),
    loadId: 0,
    retryCount: 0,
  } as unknown as DialogState;
  return { state, mapArea };
}

let shadowRoots: ShadowRoot[] = [];
const realAttach = Element.prototype.attachShadow;

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.body.replaceChildren();
  config.CLUSTERS_CAMPUS = "";
  getClusterData.mockReset();
  getClusterData.mockRejectedValue(new Error("no campus file"));
  shadowRoots = [];
  // The dialog's root is closed: keep a handle to look inside it.
  Element.prototype.attachShadow = function (init) {
    const root = realAttach.call(this, init);
    shadowRoots.push(root);
    return root;
  };
  HTMLDialogElement.prototype.showModal = vi.fn();
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
  // Nothing scraped from meta.intra.42.fr, no occupancy: the empty case.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 503 })),
  );
});
afterEach(() => {
  Element.prototype.attachShadow = realAttach;
  vi.unstubAllGlobals();
  document.getElementById("cluster-map-dialog")?.remove();
});

describe("campus shown by the dialog", () => {
  it("names the manifest campus, else the id, else the viewer's own", () => {
    expect(campusDisplayName(MANIFEST.campuses, "48")).toBe("Mulhouse");
    expect(campusDisplayName(MANIFEST.campuses, "99")).toBe("99");
    expect(campusDisplayName(MANIFEST.campuses, "")).toBe("your campus");
  });

  it("does not look up a campus file for the unknown campus", async () => {
    await buildClusters("");
    expect(getClusterData).not.toHaveBeenCalled();
    await buildClusters("48");
    expect(getClusterData).toHaveBeenCalledWith("48");
  });

  it("opens on the viewer's campus, never on Abu Dhabi, when none is detected", async () => {
    void openClusterDialog();
    await settle();
    const shadow = shadowRoots.find((r) => r.getElementById("campus-trigger-name"));
    expect(shadow).toBeDefined();
    expect(shadow!.getElementById("campus-trigger-name")!.textContent).toBe(
      "YOUR CAMPUS",
    );
    expect(getCampusExits).not.toHaveBeenCalledWith("");
    const empty = shadow!.getElementById("no-cluster-data");
    expect(empty?.textContent).toBe("No cluster map for your campus");
  });

  it("keeps a detected campus the manifest does not list", async () => {
    config.CLUSTERS_CAMPUS = "99";
    void openClusterDialog();
    await settle();
    const shadow = shadowRoots.find((r) => r.getElementById("campus-trigger-name"));
    expect(shadow!.getElementById("campus-trigger-name")!.textContent).toBe("99");
    expect(shadow!.getElementById("no-cluster-data")?.textContent).toBe(
      "No cluster map for 99",
    );
  });
});

describe("map pane messages", () => {
  it("names the campus in the empty state", () => {
    const { state, mapArea } = stateWithMap();
    renderNoClusterData(state, "48");
    expect(mapArea.textContent).toBe("No cluster map for Mulhouse");
  });

  it("shows 'Failed to load map' with a Retry that reloads the cluster", async () => {
    const { state, mapArea } = stateWithMap();
    state.activeCampusId = "48";
    const cluster = { id: "k0", name: "k0", svg: "https://cdn.intra.42.fr/k0.svg" };
    await loadCluster(state, cluster);
    expect(mapArea.textContent).toContain("Failed to load map");
    const retry = mapArea.querySelector<HTMLButtonElement>("#map-retry");
    expect(retry).not.toBeNull();

    // the worker is back: Retry gets the map
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>', {
            status: 200,
          }),
      ),
    );
    retry!.click();
    await settle();
    expect(mapArea.querySelector("svg")).not.toBeNull();
    expect(mapArea.querySelector("#map-retry")).toBeNull();
  });

  it("gives up after one retry when the map cannot be shown at all", async () => {
    const { state, mapArea } = stateWithMap();
    state.activeCampusId = "48";
    const cluster = { id: "k0", name: "k0", svg: "https://cdn.intra.42.fr/k0.svg" };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>', {
            status: 200,
          }),
      ),
    );
    const importNode = vi
      .spyOn(document, "importNode")
      .mockImplementation(() => {
        throw new Error("cannot lay out");
      });
    // used to retry itself forever: loadCluster() reset the retry count
    await loadCluster(state, cluster);
    expect(importNode).toHaveBeenCalledTimes(2);
    expect(mapArea.querySelector("#map-retry")).not.toBeNull();
    importNode.mockRestore();
  }, 3000);

  it("renderMapError alone draws the block", () => {
    const { state, mapArea } = stateWithMap();
    renderMapError(state, { id: "k0", name: "k0" });
    expect(mapArea.querySelector("#map-error")).not.toBeNull();
    expect(mapArea.querySelector("#map-retry")?.textContent).toBe("Retry");
  });
});
