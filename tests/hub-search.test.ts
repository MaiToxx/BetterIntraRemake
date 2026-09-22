/**
 * The settings search of the hub header: it filters the cards of every tab by
 * label and description (case and accents ignored), names the matching tabs,
 * moves to one of them, and clears on Escape. It must leave the dependency
 * gating alone: a card hidden because its parent is off stays hidden through
 * a search and its clearing.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { normalizeSearchText } from "../src/features/hub/hubSettings.data.ts";

vi.mock("../src/features/hub/controls/context.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/features/hub/controls/context.ts")>()),
  loadLiveOptions: vi.fn(async () => ({ campuses: [], eventTypes: [] })),
}));

beforeAll(async () => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  (window as unknown as { matchMedia: unknown }).matchMedia ??= vi.fn(() => ({ matches: true }));
  const storage = chrome.storage as unknown as { onChanged?: unknown };
  storage.onChanged ??= { addListener: vi.fn(), removeListener: vi.fn() };
  // CUSTOM_ACCENT_ENABLED is off: its colour picker opens hidden
  await chrome.storage.local.set({ CUSTOM_ACCENT_ENABLED: false });
  const { openHubModal } = await import("../src/features/hub/hubSettings.ui.ts");
  await openHubModal(["profile", "logtime"]);
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}, 30000);

let shadow: ShadowRoot;
let input: HTMLInputElement;

function type(text: string) {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const visibleCards = () =>
  [...shadow.querySelectorAll<HTMLElement>("[data-search]")].filter(
    (c) => !c.classList.contains("search-hidden"),
  );

const keyOf = (card: Element) =>
  card.querySelector<HTMLElement>("[data-setting-key]")?.dataset.settingKey;

const checkedTab = () =>
  shadow.querySelector<HTMLInputElement>('input[name="hub_tabs"]:checked')!.value;

beforeEach(() => {
  const dialog = document.getElementById("hub-dialog") as HTMLDialogElement;
  shadow = dialog.querySelector("#hub-shadow-wrapper")!.shadowRoot!;
  input = shadow.querySelector<HTMLInputElement>("#hub-search")!;
  type("");
});

describe("normalizeSearchText", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalizeSearchText("Couleur d'Accent")).toBe("couleur d accent");
    expect(normalizeSearchText("  Émoji   récompense ")).toBe("emoji recompense");
    expect(normalizeSearchText("FOOTER")).toBe("footer");
  });
});

describe("settings search", () => {
  it("is a named search field in the header", () => {
    expect(input.getAttribute("aria-label")).toBe("Search settings");
    expect(input.type).toBe("search");
  });

  it("'footer' leaves the footer switch alone and moves to Customize", () => {
    type("footer");
    const left = visibleCards();
    expect(left.map(keyOf)).toEqual(["CUSTOM_HIDE_FOOTER"]);
    expect(checkedTab()).toBe("customize");
    expect(shadow.querySelector("#hub-search-results")!.textContent).toBe(
      "Matches in Customize (1)",
    );
    // the tab label carries the count
    const customizeTab = shadow.querySelector<HTMLInputElement>(
      'input[name="hub_tabs"][value="customize"]',
    )!;
    const badge = customizeTab.parentElement!.querySelector("[data-tab-count]")!;
    expect(badge.textContent).toBe("1");
    expect(badge.classList.contains("hidden")).toBe(false);
    // aria-selected followed the switch, as it does for a click or an arrow key
    expect(customizeTab.getAttribute("aria-selected")).toBe("true");
  });

  it("ignores accents and case in the query, and matches every word", () => {
    type("FÓOTER");
    expect(visibleCards().map(keyOf)).toEqual(["CUSTOM_HIDE_FOOTER"]);
    type("hide footer");
    expect(visibleCards().map(keyOf)).toEqual(["CUSTOM_HIDE_FOOTER"]);
  });

  it("searches descriptions too, across tabs", () => {
    type("average");
    const keys = visibleCards().map(keyOf);
    expect(keys).toContain("LOGTIME_SHOW_AVERAGE");
    expect(shadow.querySelector("#hub-search-results")!.textContent).toMatch(/^Matches in /);
  });

  it("says when nothing matches, and hides the section titles meanwhile", () => {
    type("zzqqxx");
    expect(visibleCards()).toHaveLength(0);
    expect(shadow.querySelector("#hub-search-results")!.textContent).toBe("No setting matches");
    const divider = shadow.querySelector("[data-search-divider]")!;
    expect(divider.classList.contains("search-hidden")).toBe(true);
    type("");
    expect(divider.classList.contains("search-hidden")).toBe(false);
  });

  it("Escape clears the query and restores every card", () => {
    type("footer");
    const all = shadow.querySelectorAll("[data-search]").length;
    expect(visibleCards().length).toBeLessThan(all);
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(visibleCards().length).toBe(all);
    expect(shadow.querySelector("#hub-search-results")!.textContent).toBe("");
    // with no query, Escape is the dialog's to handle
    const esc2 = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(esc2);
    expect(esc2.defaultPrevented).toBe(false);
  });

  it("does not fight the dependency gating", () => {
    const colour = shadow
      .querySelector('[data-setting-key="CUSTOM_ACCENT_COLOR"]')!
      .closest(".card")!;
    expect(colour.classList.contains("hidden")).toBe(true);
    type("accent");
    // a match, but its parent is still off
    expect(colour.classList.contains("search-hidden")).toBe(false);
    expect(colour.classList.contains("hidden")).toBe(true);
    type("");
    expect(colour.classList.contains("hidden")).toBe(true);
  });

  it("'/' focuses the field from the tabs, not from a text field", () => {
    const focused = vi.fn();
    input.addEventListener("focus", focused);
    const tab = shadow.querySelector<HTMLInputElement>('input[name="hub_tabs"]')!;
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, composed: true }));
    expect(focused).toHaveBeenCalledTimes(1);
    const text = shadow.querySelector<HTMLInputElement>('input[type="text"], textarea')!;
    text.focus();
    const slash = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    text.dispatchEvent(slash);
    expect(slash.defaultPrevented).toBe(false);
  });
});
