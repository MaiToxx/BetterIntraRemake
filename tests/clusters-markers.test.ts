/**
 * "Show chair markers" only makes sense where the campus file places markers
 * (Belgium today). Everywhere else the toggle changed nothing, in the map
 * dialog's settings menu and on the meta.intra cluster page: it is drawn only
 * when the loaded campus has marker definitions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, nothing } from "lit-html";

vi.mock("../src/core/styles/shared-styles.ts", () => ({
  sharedStylesLink: () => nothing,
  adoptSharedStyles: () => {},
}));

const campusFile = vi.hoisted(() => ({
  clusters: [{ id: "1", name: "k1" }],
  definitions: {} as Record<string, unknown>,
}));
vi.mock("../src/features/campus/campus.ts", () => ({
  CLUSTERS: [] as unknown[],
  ensureCampusData: async () => {},
  fetchCampusList: async () => ({ campuses: [] }),
  loadCampusData: async () => campusFile,
}));

const { getClusterData, hasMarkerDefinitions, clearClusterData } = await import(
  "../src/features/clusters/clusters.data.ts"
);
const { renderTemplate } = await import(
  "../src/features/clusters/map-dialog/template.ts"
);
const { renderClusterPicker } = await import("../src/features/clusters/ui.ts");
type DialogState = import("../src/features/clusters/map-dialog/context.ts").DialogState;

const BELGIUM = {
  paul: { rows: [{ range: "r1-r2", pos: [1, 2], dir: "UP" }] },
};

function dialogState(): DialogState {
  return {
    currentTheme: "dark",
    campusOptions: [{ id: "12", name: "Belgium" }],
    activeCampusId: "12",
    clusters: [{ id: "1", name: "paul" }],
    defaultId: "1",
    showMarkers: true,
  } as unknown as DialogState;
}

function renderDialog(): HTMLElement {
  const host = document.createElement("div");
  render(renderTemplate(dialogState()), host);
  return host;
}

function renderPicker(): HTMLElement {
  const host = document.createElement("div");
  render(renderClusterPicker("1", true, () => {}, () => {}), host);
  return host;
}

const markerButtons = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].filter((b) =>
    /show chair markers/i.test(b.textContent ?? ""),
  );

beforeEach(() => {
  clearClusterData();
  campusFile.definitions = {};
});

describe("hasMarkerDefinitions", () => {
  it("is false for a campus file without definitions (Mulhouse and 40 others)", async () => {
    await getClusterData("7");
    expect(hasMarkerDefinitions()).toBe(false);
  });

  it("is true once Belgium's definitions are loaded", async () => {
    campusFile.definitions = BELGIUM;
    await getClusterData("12");
    expect(hasMarkerDefinitions()).toBe(true);
  });
});

describe("the marker toggles follow the loaded campus", () => {
  it("map dialog: no #markers-btn without definitions, one with", async () => {
    await getClusterData("7");
    expect(renderDialog().querySelector("#markers-btn")).toBeNull();

    campusFile.definitions = BELGIUM;
    await getClusterData("12");
    const btn = renderDialog().querySelector("#markers-btn");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-pressed")).toBe("true");
  });

  it("cluster page picker: no marker button (nor its divider) without definitions", async () => {
    await getClusterData("7");
    const host = renderPicker();
    expect(markerButtons(host)).toHaveLength(0);
    expect(host.querySelector(".w-px")).toBeNull();
    // the default cluster select is still there
    expect(host.querySelector("#cluster-select")).not.toBeNull();

    campusFile.definitions = BELGIUM;
    await getClusterData("12");
    expect(markerButtons(renderPicker())).toHaveLength(1);
  });
});
