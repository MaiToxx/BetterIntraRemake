/**
 * Settings hub: every control a screen reader reaches must say what it is.
 * The label of a setting is a <span> in its card and the control sits in a
 * sibling <div>, so nothing tied them together: a toggle read "checkbox,
 * checked", a select "combo box". These cases render the real controls and
 * resolve each one's accessible name the way a browser does for these
 * shapes (aria-labelledby, then aria-label, then <label>, then content).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "lit-html";
import {
  FEATURE_DEFS,
  HUB_SETTING_DEFS,
  type HubSettingDef,
} from "../src/features/hub/hubSettings.data.ts";
import { renderSetting } from "../src/features/hub/controls/setting.ts";
import { bindTabPanels, renderTabsContent } from "../src/features/hub/controls/tab-panel.ts";
import { settingIds, type LiveOptions } from "../src/features/hub/controls/context.ts";

const LIVE: LiveOptions = { campuses: [], eventTypes: [] };

/** Kinds whose controls another module draws (shortcuts, presets, cards...). */
const OTHER_MODULES = new Set(["shortcuts", "about", "calendar-panel", "custom-presets", "custom-cards"]);

const CONTROLS = "input:not([type=hidden]), select, textarea, button, summary";

/** Visible text of a subtree, without aria-hidden parts and <style>. */
function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.getAttribute("aria-hidden") === "true" || node.tagName === "STYLE") return "";
  if (node.getAttribute("aria-label")) return node.getAttribute("aria-label")!;
  return [...node.childNodes].map(textOf).join(" ");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** What is printed on an element, whatever its aria-label says. */
function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.getAttribute("aria-hidden") === "true" || node.tagName === "STYLE") return "";
  return squash([...node.childNodes].map(visibleText).join(" "));
}

/** The ids a control points at, resolved in its own root. */
function referenced(el: Element, attr: string): string {
  const root = el.getRootNode() as ShadowRoot | Document;
  const ids = (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean);
  return squash(
    ids
      .map((id) => {
        const target = root.getElementById(id);
        // A reference to nothing is a bug too: make it visible.
        return target ? textOf(target) : `<missing #${id}>`;
      })
      .join(" "),
  );
}

function accessibleName(el: Element): string {
  if (el.hasAttribute("aria-labelledby")) return referenced(el, "aria-labelledby");
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return squash(aria);
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const t = squash([...labels].map(textOf).join(" "));
    if (t) return t;
  }
  if (el.tagName === "BUTTON" || el.tagName === "SUMMARY") return squash(textOf(el));
  return squash(el.getAttribute("title") ?? "");
}

function description(el: Element): string {
  return referenced(el, "aria-describedby");
}

/** Resolves every until() and async renderer of a freshly rendered root. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

function shadowRoot(): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host.attachShadow({ mode: "open" });
}

const allDefs = Object.values(HUB_SETTING_DEFS).flat();
const ownDefs = allDefs.filter((d) => d.kind !== "divider" && !OTHER_MODULES.has(d.kind));

async function renderOne(def: HubSettingDef): Promise<ShadowRoot> {
  const root = shadowRoot();
  render(renderSetting(def, true, false, LIVE), root);
  await settle();
  return root;
}

beforeEach(async () => {
  document.body.replaceChildren();
  await chrome.storage.local.clear();
  // Some panels of the full tab list watch storage; the shared mock has no events.
  const storage = chrome.storage as unknown as { onChanged?: unknown };
  storage.onChanged ??= { addListener: vi.fn(), removeListener: vi.fn() };
});

describe("every setting control has a name", () => {
  it("covers the settings this module family draws", () => {
    expect(ownDefs.length).toBeGreaterThan(90);
  });

  it("names each control after its visible label, and describes it with the setting's text", async () => {
    const unnamed: string[] = [];
    const mislabelled: string[] = [];
    const undescribed: string[] = [];
    // All of them in one root, as in the hub: the ids must not collide either.
    const root = shadowRoot();
    const cards = ownDefs.map((def) => {
      const card = document.createElement("div");
      root.appendChild(card);
      render(renderSetting(def, true, false, LIVE), card);
      return card;
    });
    await settle();
    const ids = [...root.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    for (const [i, def] of ownDefs.entries()) {
      for (const el of cards[i].querySelectorAll(CONTROLS)) {
        const name = accessibleName(el);
        const where = `${def.feature}/${def.key ?? def.label} ${el.tagName.toLowerCase()}`;
        if (!name || name.includes("<missing")) unnamed.push(`${where}: "${name}"`);
      }
      // The control a single-value setting is made of carries the label itself.
      if (["toggle", "number", "select", "color", "url", "text", "textarea", "emoji"].includes(def.kind)) {
        const el = cards[i].querySelector(`[data-setting-key="${def.key}"]`)!;
        expect(el, def.key).not.toBeNull();
        if (!accessibleName(el).includes(def.label)) mislabelled.push(`${def.key}: "${accessibleName(el)}"`);
        if (def.desc && !description(el).includes(squash(def.desc))) {
          undescribed.push(`${def.key}: "${description(el)}"`);
        }
      }
    }
    expect(unnamed).toEqual([]);
    expect(mislabelled).toEqual([]);
    expect(undescribed).toEqual([]);
  }, 30_000);

  it("groups radio buttons under the setting's label", async () => {
    for (const def of ownDefs.filter((d) => d.kind === "radio-group" || d.kind === "theme-preset")) {
      const root = await renderOne(def);
      const group = root.querySelector('[role="radiogroup"]');
      expect(group, def.key).not.toBeNull();
      expect(accessibleName(group!)).toBe(def.label);
      for (const radio of group!.querySelectorAll("input[type=radio]")) {
        expect(accessibleName(radio)).not.toBe("");
      }
    }
  });

  it("says which rainbow palette is picked, after the setting's label", async () => {
    const def = ownDefs.find((d) => d.kind === "rainbow-palette")!;
    const root = await renderOne(def);
    const summary = root.querySelector("summary")!;
    const current = (def.options ?? [])[0]!.label!;
    expect(accessibleName(summary)).toBe(`${def.label} ${current}`);
  });

  it("names the buttons of the maintenance actions after their setting", async () => {
    for (const def of ownDefs.filter((d) => d.kind === "action")) {
      const root = await renderOne(def);
      for (const button of root.querySelectorAll("button")) {
        const name = accessibleName(button);
        // The visible word stays in the name, for voice control.
        expect(name).toContain(visibleText(button));
        const group = button.closest('[role="group"]');
        expect(name === def.label || (group && accessibleName(group) === def.label), def.label).toBeTruthy();
      }
    }
  });
});

describe("dashboard card order", () => {
  it("names the eye buttons after the card and what they do", async () => {
    const def = ownDefs.find((d) => d.kind === "card-order")!;
    await chrome.storage.local.set({ [def.key!]: ["AGENDA", "-LOGTIME", "PROJECTS"] });
    const root = await renderOne(def);
    /** The eye button in the chip of `card`. */
    const eyeOf = (card: string) =>
      [...root.querySelectorAll<HTMLButtonElement>("button[data-tip]")].find(
        (b) => b.parentElement!.textContent!.includes(card),
      )!;
    expect(accessibleName(eyeOf("AGENDA"))).toBe("Hide AGENDA card");
    expect(accessibleName(eyeOf("LOGTIME"))).toBe("Show LOGTIME card");
    const panel = root.querySelector("[data-card-order-panel]")!;
    expect(panel.getAttribute("role")).toBe("group");
    expect(accessibleName(panel)).toBe(def.label);
    // Showing the hidden card flips its button's name.
    eyeOf("LOGTIME").click();
    await settle();
    expect(accessibleName(eyeOf("LOGTIME"))).toBe("Hide LOGTIME card");
  });
});

describe("public profile link fields", () => {
  const linkDef = allDefs.find((d) => d.linkKind === "github")!;

  it("ties the 'Not recognised' hint to the field, only while it shows", async () => {
    const root = await renderOne(linkDef);
    const input = root.querySelector<HTMLInputElement>(`[data-setting-key="${linkDef.key}"]`)!;
    const hint = root.querySelector<HTMLElement>("[data-link-hint]")!;
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(description(input)).not.toContain("Not recognised");

    input.value = "https://example.com/not-github";
    input.dispatchEvent(new Event("input"));
    expect(hint.hidden).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description(input)).toContain("Not recognised");
    if (linkDef.desc) expect(description(input)).toContain(squash(linkDef.desc));

    input.value = "octocat";
    input.dispatchEvent(new Event("input"));
    expect(hint.hidden).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(description(input)).not.toContain("Not recognised");
  });

  it("starts invalid when the stored value is not a link it can read", async () => {
    await chrome.storage.local.set({ [linkDef.key!]: "https://example.com/nope" });
    const root = await renderOne(linkDef);
    const input = root.querySelector(`[data-setting-key="${linkDef.key}"]`)!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description(input)).toContain("Not recognised");
  });
});

describe("the tabs", () => {
  const gates = { disabled: new Set<string>(), hidden: new Set<string>() };

  async function renderTabs(): Promise<ShadowRoot> {
    const root = shadowRoot();
    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    root.appendChild(list);
    render(renderTabsContent(["logtime", "profile"], gates, LIVE), list);
    await settle();
    return root;
  }

  it("names every tab after its feature and ties each panel to its tab", async () => {
    const root = await renderTabs();
    const tabs = [...root.querySelectorAll<HTMLInputElement>('input[name="hub_tabs"]')];
    expect(tabs.map(accessibleName)).toEqual(FEATURE_DEFS.map((f) => f.name));
    for (const tab of tabs) {
      expect(tab.getAttribute("role")).toBe("tab");
      const panel = root.getElementById(tab.getAttribute("aria-controls")!)!;
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(accessibleName(panel)).toBe(accessibleName(tab));
    }
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(
      FEATURE_DEFS.map((_, i) => String(i === 0)),
    );
  });

  it("keeps aria-selected on the checked tab as the arrow keys move it", async () => {
    const root = await renderTabs();
    bindTabPanels(root);
    const tabs = [...root.querySelectorAll<HTMLInputElement>('input[name="hub_tabs"]')];
    // The browser moves `checked` along the radio group on an arrow key and
    // fires "change": the same as this.
    tabs[2].checked = true;
    tabs[2].dispatchEvent(new Event("change", { bubbles: true }));
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(
      tabs.map((_, i) => String(i === 2)),
    );
  });

  it("stays keyboard-reachable: one tab stop, the radio group moves between tabs", async () => {
    const root = await renderTabs();
    const tabs = [...root.querySelectorAll<HTMLInputElement>('input[name="hub_tabs"]')];
    // Same name: the browser makes them one radio group (Tab reaches the
    // checked one, the arrow keys switch tabs), and none is taken out of it.
    expect(new Set(tabs.map((t) => t.name)).size).toBe(1);
    for (const t of tabs) {
      expect(t.type).toBe("radio");
      expect(t.disabled).toBe(false);
      expect(t.getAttribute("tabindex")).toBeNull();
    }
  });

  it("names the feature switches, Reset buttons and the 42 connect button", async () => {
    const root = await renderTabs();
    const toggles = [...root.querySelectorAll<HTMLInputElement>("input.hub-feature-toggle")];
    expect(toggles.length).toBeGreaterThan(0);
    for (const t of toggles) {
      const f = FEATURE_DEFS.find((d) => d.id === t.dataset.id)!;
      expect(accessibleName(t)).toBe(`Enable ${f.name}`);
      expect(description(t)).toBe(f.desc);
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>("[data-reset-feature]")) {
      const f = FEATURE_DEFS.find((d) => d.id === b.dataset.resetFeature)!;
      expect(accessibleName(b)).toBe(`Reset ${f.name} settings`);
      expect(accessibleName(b)).toContain(visibleText(b));
    }
    // The panels other modules draw (presets, card colours, shortcuts, the
    // Calendar and About tabs) are theirs to name; everything else is here.
    const foreign = [
      '[data-feature-panel="about"]',
      '[data-feature-panel="calendar"]',
      ...allDefs
        .filter((d) => OTHER_MODULES.has(d.kind))
        .map((d) => `[aria-labelledby="${settingIds(d).label}"]`),
    ].join(", ");
    const controls = [...root.querySelectorAll(CONTROLS)].filter((el) => !el.closest(foreign));
    expect(controls.length).toBeGreaterThan(100);
    const unnamed = controls.filter((el) => !accessibleName(el) || accessibleName(el).includes("<missing"));
    expect(unnamed.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });
});
