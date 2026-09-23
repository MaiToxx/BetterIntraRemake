/**
 * Dashboard card order without drag and drop: HTML5 drags start from a
 * mouse only, so a keyboard (and a finger on a touch screen) could not
 * reorder the cards at all. Each visible card has "earlier" / "later"
 * buttons that do what a drop does, stored the same way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "lit-html";
import { HUB_SETTING_DEFS } from "../src/features/hub/hubSettings.data.ts";
import { renderSetting } from "../src/features/hub/controls/setting.ts";

// every default card, so the stored order is shown as it is (a missing one
// is appended by getConfig)
const REST = ["EVALUATIONS", "ACHIEVEMENTS", "THURSDAY ROULETTE"];

const def = Object.values(HUB_SETTING_DEFS)
  .flat()
  .find((d) => d.kind === "card-order")!;

async function mount(order: string[], enabled = true): Promise<ShadowRoot> {
  await chrome.storage.local.set({ [def.key!]: order });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  render(renderSetting(def, enabled, false, { campuses: [], eventTypes: [] }), root);
  await vi.waitFor(() => expect(root.querySelectorAll("[data-card-chip]").length).toBe(order.length));
  return root;
}

const button = (root: ShadowRoot, label: string) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const storedOrder = async () => (await chrome.storage.local.get(def.key!))[def.key!] as string[];

beforeEach(async () => {
  document.body.replaceChildren();
  await chrome.storage.local.clear();
});

describe("dashboard card order", () => {
  it("moves a card later and earlier with its arrows, and stores the order", async () => {
    const root = await mount(["AGENDA", "LOGTIME", "PROJECTS", ...REST]);
    expect(button(root, "Move AGENDA card earlier")!.disabled).toBe(true);
    expect(button(root, "Move THURSDAY ROULETTE card later")!.disabled).toBe(true);

    const later = button(root, "Move AGENDA card later")!;
    later.focus();
    later.click();
    await vi.waitFor(async () =>
      expect((await storedOrder()).slice(0, 3)).toEqual(["LOGTIME", "AGENDA", "PROJECTS"]),
    );
    // the focus follows the card, so the same key moves it again
    expect(root.activeElement).toBe(button(root, "Move AGENDA card later"));

    button(root, "Move PROJECTS card earlier")!.click();
    await vi.waitFor(async () =>
      expect((await storedOrder()).slice(0, 3)).toEqual(["LOGTIME", "PROJECTS", "AGENDA"]),
    );
  });

  it("offers no arrows on a hidden card, nor while the Profile tab is off", async () => {
    const root = await mount(["AGENDA", "-LOGTIME", "PROJECTS", ...REST]);
    expect(button(root, "Move LOGTIME card earlier")).toBeNull();
    expect(button(root, "Move AGENDA card later")).not.toBeNull();

    document.body.replaceChildren();
    const off = await mount(["AGENDA", "LOGTIME", "PROJECTS", ...REST], false);
    expect(off.querySelector("[data-card-move]")).toBeNull();
  });
});
