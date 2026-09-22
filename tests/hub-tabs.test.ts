/**
 * The tabs of the hub: which one opens (the one the user was on, since most
 * settings only apply after the Reload it asks for), which switches are
 * drawn (no chair-markers switch for a campus without chair data, no dead
 * "connect your account" gate), and the one list that says which features
 * have an on/off switch.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render } from "lit-html";
import { CONFIG_DEFAULT } from "../src/core/config.ts";
import {
  FEATURE_DEFS,
  TOGGLEABLE_FEATURE_IDS,
} from "../src/features/hub/hubSettings.data.ts";
import {
  TAB_MEMORY_KEY,
  bindTabPanels,
  rememberedTab,
  renderTabsContent,
} from "../src/features/hub/controls/tab-panel.ts";
import { getActiveFeatures } from "../src/features/hub/hubSettings.storage.ts";
import type { LiveOptions } from "../src/features/hub/controls/context.ts";

const GATES = { disabled: new Set<string>(), hidden: new Set<string>() };

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

function renderTabs(live: LiveOptions, initial?: Parameters<typeof renderTabsContent>[3]) {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  render(renderTabsContent(["logtime", "clusters"], GATES, live, initial), shadow);
  document.body.appendChild(host);
  return shadow;
}

beforeAll(() => {
  // the cards panel and the calendar panel listen for storage changes
  const storage = chrome.storage as unknown as { onChanged?: unknown };
  storage.onChanged ??= { addListener: vi.fn(), removeListener: vi.fn() };
});

beforeEach(async () => {
  sessionStorage.clear();
  await chrome.storage.local.clear();
  document.body.replaceChildren();
});

describe("tab memory", () => {
  it("opens on the first tab when nothing is remembered or the memory is garbage", () => {
    expect(rememberedTab()).toBe(FEATURE_DEFS[0].id);
    sessionStorage.setItem(TAB_MEMORY_KEY, "not-a-tab");
    expect(rememberedTab()).toBe(FEATURE_DEFS[0].id);
  });

  it("opens on the remembered tab, selected for the screen reader too", () => {
    sessionStorage.setItem(TAB_MEMORY_KEY, "logtime");
    const shadow = renderTabs({ campuses: [], eventTypes: [] }, rememberedTab());
    const checked = shadow.querySelector<HTMLInputElement>('input[name="hub_tabs"]:checked')!;
    expect(checked.value).toBe("logtime");
    expect(checked.getAttribute("aria-selected")).toBe("true");
    const first = shadow.querySelector<HTMLInputElement>('input[name="hub_tabs"]')!;
    expect(first.checked).toBe(false);
    expect(first.getAttribute("aria-selected")).toBe("false");
  });

  it("remembers the tab the user moves to", () => {
    const shadow = renderTabs({ campuses: [], eventTypes: [] });
    bindTabPanels(shadow);
    const customize = shadow.querySelector<HTMLInputElement>(
      'input[name="hub_tabs"][value="customize"]',
    )!;
    customize.checked = true;
    customize.dispatchEvent(new Event("change", { bubbles: true }));
    expect(sessionStorage.getItem(TAB_MEMORY_KEY)).toBe("customize");
    expect(rememberedTab()).toBe("customize");
  });
});

describe("what a tab draws", () => {
  it("has no chair-markers switch unless the campus file declares chair data", async () => {
    const without = renderTabs({ campuses: [], eventTypes: [], chairMarkers: false });
    await settle();
    expect(without.querySelector('[data-setting-key="CLUSTERS_SHOW_MARKERS"]')).toBeNull();
    // the other Clusters settings are still there
    expect(without.querySelector('[data-setting-key="CLUSTERS_OPEN_NEW_TAB"]')).not.toBeNull();

    const belgium = renderTabs({ campuses: [], eventTypes: [], chairMarkers: true });
    await settle();
    expect(belgium.querySelector('[data-setting-key="CLUSTERS_SHOW_MARKERS"]')).not.toBeNull();
  });

  it("the Clusters tab no longer promises markers to every campus", () => {
    const clusters = FEATURE_DEFS.find((f) => f.id === "clusters")!;
    expect(clusters.desc).not.toMatch(/^Adds 'chair'/);
    expect(clusters.desc).toMatch(/where the campus provides them/);
  });

  it("carries no unreachable 'connect your 42 account' gate", () => {
    const shadow = renderTabs({ campuses: [], eventTypes: [] });
    expect(shadow.textContent).not.toContain("Connect your 42 account to unlock");
  });
});

describe("feature switch policy", () => {
  it("the toggleable features are the default ACTIVE_SCRIPTS", () => {
    expect([...TOGGLEABLE_FEATURE_IDS].sort()).toEqual([...CONFIG_DEFAULT.ACTIVE_SCRIPTS].sort());
  });

  it("only toggleable tabs draw a feature switch", () => {
    const shadow = renderTabs({ campuses: [], eventTypes: [] });
    const switches = [...shadow.querySelectorAll<HTMLElement>("input.hub-feature-toggle")].map(
      (t) => t.dataset.id,
    );
    expect(switches.sort()).toEqual([...TOGGLEABLE_FEATURE_IDS].sort());
  });

  it("garbage in ACTIVE_SCRIPTS falls back to the toggleable features, not every tab", async () => {
    await chrome.storage.local.set({ ACTIVE_SCRIPTS: "not json" });
    expect((await getActiveFeatures()).sort()).toEqual([...TOGGLEABLE_FEATURE_IDS].sort());
    await chrome.storage.local.set({ ACTIVE_SCRIPTS: ["unknown-feature"] });
    expect((await getActiveFeatures()).sort()).toEqual([...TOGGLEABLE_FEATURE_IDS].sort());
  });
});
