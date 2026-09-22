/**
 * Cluster map dialog: its buttons are icon- or symbol-only and were named by
 * a data-tip alone, which the floating tooltip only showed to the mouse. A
 * screen reader read "button" thirteen times and Tab reached "−" and "⟳" with
 * no text at all. Every control now has an accessible name and the tooltip
 * follows keyboard focus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, nothing } from "lit-html";

vi.mock("../src/core/styles/shared-styles.ts", () => ({
  sharedStylesLink: () => nothing,
}));
vi.mock("../src/features/clusters/clusters.data.ts", () => ({
  hasMarkerDefinitions: () => true,
  SCREENS: {},
  CLUSTERS: [],
}));

const { renderTemplate } = await import(
  "../src/features/clusters/map-dialog/template.ts"
);
const { renderTabsRegion } = await import(
  "../src/features/clusters/map-dialog/tabs.ts"
);
const { updateActiveSortControls } = await import(
  "../src/features/clusters/map-dialog/active-sort.ts"
);
const { bindTooltips, TOOLTIP_SHOW_DELAY } = await import(
  "../src/core/dom/tooltip.ts"
);
type DialogState = import("../src/features/clusters/map-dialog/context.ts").DialogState;

/** Visible text of a subtree, without aria-hidden parts. */
function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.getAttribute("aria-hidden") === "true" || node.tagName === "STYLE") return "";
  if (node.getAttribute("aria-label")) return node.getAttribute("aria-label")!;
  return [...node.childNodes].map(textOf).join(" ");
}
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return squash(aria);
  if (el.tagName === "BUTTON" || el.tagName === "SUMMARY") return squash(textOf(el));
  return "";
}

/** A name a screen reader can say: has a letter, not a bare "+" or "✕". */
const isWordy = (name: string) => /[a-z]/i.test(name);

function dialogState(shadow: ShadowRoot): DialogState {
  return {
    shadow,
    currentTheme: "dark",
    campusOptions: [{ id: "48", name: "Mulhouse" }],
    activeCampusId: "48",
    clusters: [
      { id: "1", name: "k1", svg: "https://cdn.intra.42.fr/k1.svg" },
      { id: "2", name: "", svg: "https://cdn.intra.42.fr/k2.svg" },
    ],
    activeCluster: { id: "1", name: "k1" },
    defaultId: "1",
    showMarkers: false,
    tabsState: { wired: new WeakSet(), overflowing: false, resizeObserver: null },
    seatPosCache: new Map(),
    activeUsers: [],
    occupancyCache: null,
    activeSortMode: "name",
    activeNameDir: "asc",
    activeSinceDir: "desc",
    activeWifiOnly: true,
  } as unknown as DialogState;
}

function renderDialog(): { shadow: ShadowRoot; state: DialogState } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const state = dialogState(shadow);
  render(renderTemplate(state), shadow);
  renderTabsRegion(state);
  updateActiveSortControls(state);
  return { shadow, state };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("map dialog controls have names", () => {
  it("every button says what it does, in words", () => {
    const { shadow } = renderDialog();
    const buttons = [...shadow.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThanOrEqual(13);
    const unnamed = buttons
      .filter((b) => !isWordy(accessibleName(b)))
      .map((b) => b.id || b.className);
    expect(unnamed).toEqual([]);
  });

  it("names the icon-only ones after their tooltip", () => {
    const { shadow } = renderDialog();
    const expected: Record<string, string> = {
      "settings-btn": "Settings",
      "maximize-btn": "Maximize",
      "close-btn": "Close",
      "updated-badge": "Reload occupancy",
      "zoom-reset": "Reset zoom",
      "zoom-out": "Zoom out",
      "zoom-in": "Zoom in",
    };
    for (const [id, name] of Object.entries(expected)) {
      expect(accessibleName(shadow.getElementById(id)!), id).toBe(name);
    }
    expect(accessibleName(shadow.getElementById("campus-trigger")!)).toBe(
      "Campus: Mulhouse",
    );
    // the symbols stay visible but are not read out
    expect(squash(textOf(shadow.getElementById("zoom-out")!))).toBe("Zoom out");
  });

  it("exposes the toggles' state", () => {
    const { shadow } = renderDialog();
    expect(shadow.getElementById("active-wifi-toggle")!.getAttribute("aria-pressed")).toBe("true");
    expect(shadow.getElementById("sort-name")!.getAttribute("aria-pressed")).toBe("true");
    expect(shadow.getElementById("sort-since")!.getAttribute("aria-pressed")).toBe("false");
    expect(shadow.getElementById("markers-btn")!.getAttribute("aria-pressed")).toBe("false");
    expect(shadow.getElementById("default-cluster-select")!.getAttribute("aria-label")).toBe(
      "Default cluster",
    );
  });

  it("cluster tabs are named by their label, even without a name", () => {
    const { shadow } = renderDialog();
    const tabs = [...shadow.querySelectorAll<HTMLButtonElement>("[data-cluster-id]")];
    expect(tabs.map(accessibleName)).toEqual(["K1", "K2"]);
  });
});

describe("tooltips on keyboard focus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function tipButton(): { root: HTMLElement; btn: HTMLButtonElement } {
    const root = document.createElement("div");
    const btn = document.createElement("button");
    btn.dataset.tip = "Zoom in";
    root.appendChild(btn);
    document.body.appendChild(root);
    bindTooltips(root, () => false);
    return { root, btn };
  }

  const tooltip = () => document.getElementById("ft-floating-tooltip");

  async function flush(ms: number) {
    // the light/dark provider resolves on a microtask before the show timer
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(ms);
  }

  it("shows the tip after the hover delay when the element is focused", async () => {
    const { btn } = tipButton();
    btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush(TOOLTIP_SHOW_DELAY);
    expect(tooltip()?.textContent).toBe("Zoom in");
  });

  it("hides it when focus leaves", async () => {
    const { btn } = tipButton();
    btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush(TOOLTIP_SHOW_DELAY);
    btn.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush(1000);
    expect(tooltip()).toBeNull();
  });

  it("hides it on Escape without swallowing the key", async () => {
    const { root, btn } = tipButton();
    btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush(TOOLTIP_SHOW_DELAY);
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    root.dispatchEvent(esc);
    expect(tooltip()).toBeNull();
    expect(esc.defaultPrevented).toBe(false);
  });

  it("ignores focus landing inside a container that carries a tip", async () => {
    const { root } = tipButton();
    const card = document.createElement("div");
    card.dataset.tip = "Whole card";
    const inner = document.createElement("button");
    inner.textContent = "Inner";
    card.appendChild(inner);
    root.appendChild(card);
    inner.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await flush(TOOLTIP_SHOW_DELAY);
    expect(tooltip()).toBeNull();
  });
});
