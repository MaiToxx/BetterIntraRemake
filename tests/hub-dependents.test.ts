/**
 * Dependency gating of the hub. "On" follows the whole chain: with the accent
 * off and the two-colour accent still ticked, "Second colour" is off too (an
 * orphan card used to stay). Reset re-gates the dependants, an Extras
 * sub-switch follows its card's switch at once, and the custom font family
 * only shows for the Custom font.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { render } from "lit-html";
import {
  bindDependents,
  initialGates,
  refreshDependents,
} from "../src/features/hub/dependents.ts";
import { HUB_SETTING_DEFS } from "../src/features/hub/hubSettings.data.ts";
import { renderSetting } from "../src/features/hub/controls/setting.ts";
import { renderFeatureCards } from "../src/features/hub/controls/feature-cards.ts";
import { resetFeatureSettings } from "../src/features/hub/controls/tab-panel.ts";

const LIVE = { campuses: [], eventTypes: [] };

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

const def = (key: string) =>
  Object.values(HUB_SETTING_DEFS)
    .flat()
    .find((d) => d.key === key)!;

/** The accent chain of the Customize tab, rendered with the stored values. */
async function renderAccent(): Promise<ShadowRoot> {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);
  const gates = await initialGates();
  render(
    ["CUSTOM_ACCENT_ENABLED", "CUSTOM_ACCENT_GRADIENT", "CUSTOM_ACCENT_COLOR_2"].map((key) =>
      renderSetting(def(key), true, gates.hidden.has(key), LIVE),
    ),
    shadow,
  );
  await settle();
  bindDependents(shadow);
  return shadow;
}

const card = (root: ParentNode, key: string) =>
  root.querySelector(`[data-setting-key="${key}"]`)!.closest(".card")!;

beforeAll(() => {
  const storage = chrome.storage as unknown as { onChanged?: unknown };
  storage.onChanged ??= { addListener: vi.fn(), removeListener: vi.fn() };
});

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.body.replaceChildren();
});

describe("initialGates", () => {
  it("hides a grandchild whose grandparent is off", async () => {
    await chrome.storage.local.set({
      CUSTOM_ACCENT_ENABLED: false,
      CUSTOM_ACCENT_GRADIENT: true,
    });
    const gates = await initialGates();
    expect(gates.hidden.has("CUSTOM_ACCENT_GRADIENT")).toBe(true);
    expect(gates.hidden.has("CUSTOM_ACCENT_COLOR_2")).toBe(true);
  });

  it("shows the whole chain when every level is on", async () => {
    await chrome.storage.local.set({
      CUSTOM_ACCENT_ENABLED: true,
      CUSTOM_ACCENT_GRADIENT: true,
    });
    const gates = await initialGates();
    expect(gates.hidden.has("CUSTOM_ACCENT_GRADIENT")).toBe(false);
    expect(gates.hidden.has("CUSTOM_ACCENT_COLOR_2")).toBe(false);
  });

  it("the profile effect tint colour follows effect -> tint", async () => {
    await chrome.storage.local.set({
      PROFILE_PUB_EFFECT: "none",
      PROFILE_PUB_EFFECT_TINT: true,
    });
    const gates = await initialGates();
    expect(gates.hidden.has("PROFILE_PUB_EFFECT_COLOR")).toBe(true);
  });
});

describe("refreshDependents", () => {
  it("unticking the accent hides the gradient switch and the second colour", async () => {
    await chrome.storage.local.set({
      CUSTOM_ACCENT_ENABLED: true,
      CUSTOM_ACCENT_GRADIENT: true,
    });
    const shadow = await renderAccent();
    expect(card(shadow, "CUSTOM_ACCENT_COLOR_2").classList.contains("hidden")).toBe(false);

    const accent = shadow.querySelector<HTMLInputElement>(
      '[data-setting-key="CUSTOM_ACCENT_ENABLED"]',
    )!;
    accent.checked = false;
    accent.dispatchEvent(new Event("change", { bubbles: true }));
    expect(card(shadow, "CUSTOM_ACCENT_GRADIENT").classList.contains("hidden")).toBe(true);
    expect(card(shadow, "CUSTOM_ACCENT_COLOR_2").classList.contains("hidden")).toBe(true);

    accent.checked = true;
    accent.dispatchEvent(new Event("change", { bubbles: true }));
    expect(card(shadow, "CUSTOM_ACCENT_COLOR_2").classList.contains("hidden")).toBe(false);
  });

  it("keeps the text-parent rule: a blank parent is off", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const gates = await initialGates();
    render(
      ["CUSTOM_PAGE_BG_URL", "CUSTOM_PAGE_BG_DIM"].map((key) =>
        renderSetting(def(key), true, gates.hidden.has(key), LIVE),
      ),
      host,
    );
    await settle();
    const url = host.querySelector<HTMLInputElement>('[data-setting-key="CUSTOM_PAGE_BG_URL"]')!;
    url.value = "   ";
    refreshDependents(host);
    expect(card(host, "CUSTOM_PAGE_BG_DIM").classList.contains("hidden")).toBe(true);
    url.value = "https://example.org/a.png";
    refreshDependents(host);
    expect(card(host, "CUSTOM_PAGE_BG_DIM").classList.contains("hidden")).toBe(false);
  });
});

describe("Reset", () => {
  it("re-gates the dependants of the tab it resets", async () => {
    await chrome.storage.local.set({
      CUSTOM_ACCENT_ENABLED: true,
      CUSTOM_ACCENT_GRADIENT: true,
    });
    const shadow = await renderAccent();
    expect(card(shadow, "CUSTOM_ACCENT_COLOR_2").classList.contains("hidden")).toBe(false);
    await resetFeatureSettings(shadow, "customize");
    // the accent is back to its default (off): the colour cards go with it
    expect(card(shadow, "CUSTOM_ACCENT_GRADIENT").classList.contains("hidden")).toBe(true);
    expect(card(shadow, "CUSTOM_ACCENT_COLOR_2").classList.contains("hidden")).toBe(true);
  });
});

describe("Extras sub-switches", () => {
  it("follow their card's switch at once", async () => {
    await chrome.storage.local.set({ SHOW_FRIENDS_WIDGET: true, CLOUD_TOKEN: "t" });
    const cards = HUB_SETTING_DEFS.extras.find((d) => d.kind === "feature-cards")!;
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(await renderFeatureCards(cards, true), host);
    const parent = host.querySelector<HTMLInputElement>(
      '[data-setting-key="SHOW_FRIENDS_WIDGET"]',
    )!;
    const sub = host.querySelector<HTMLInputElement>(
      '[data-setting-key="SHOW_CUSTOM_AVATARS_IN_FRIENDS"]',
    )!;
    expect(sub.disabled).toBe(false);
    parent.checked = false;
    parent.dispatchEvent(new Event("change", { bubbles: true }));
    expect(sub.disabled).toBe(true);
    expect(sub.closest("[data-sub-toggle-row]")!.classList.contains("opacity-40")).toBe(true);
    parent.checked = true;
    parent.dispatchEvent(new Event("change", { bubbles: true }));
    expect(sub.disabled).toBe(false);
  });
});

describe("Customize defs", () => {
  it("the custom font family is only for the Custom font", () => {
    const family = def("CUSTOM_FONT_FAMILY");
    expect(family.dependsOn).toBe("CUSTOM_FONT");
    expect(family.dependsOnValues).toEqual(["custom"]);
  });
});
