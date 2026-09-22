/**
 * Number controls of the hub. The browser's min/max/step are only hints: a
 * cleared field, a word or an out-of-range number still reach the change
 * event, and the Logtime tab used to store them as they came ("" in a number
 * key, a goal of 0), which the calendar then divided by.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "lit-html";
import { normalizeNumber, renderNumber } from "../src/features/hub/controls/basic.ts";
import { LOGTIME_SETTINGS } from "../src/features/hub/settings/logtime.ts";
import type { HubSettingDef } from "../src/features/hub/hubSettings.data.ts";

const DEF: HubSettingDef = {
  feature: "logtime",
  key: "LOGTIME_GOAL_HOURS",
  label: "Monthly goal",
  desc: "Sets the target number of hours.",
  kind: "number",
  min: 1,
  max: 744,
  step: 1,
  defaultValue: 140,
};

describe("normalizeNumber", () => {
  it("falls back to the default for a blank or non-numeric field", () => {
    expect(normalizeNumber(DEF, "")).toBe(140);
    expect(normalizeNumber(DEF, "   ")).toBe(140);
    expect(normalizeNumber(DEF, "abc")).toBe(140);
    expect(normalizeNumber(DEF, "Infinity")).toBe(140);
  });

  it("clamps to the def's range", () => {
    expect(normalizeNumber(DEF, "0")).toBe(1);
    expect(normalizeNumber(DEF, "-5")).toBe(1);
    expect(normalizeNumber(DEF, "99999")).toBe(744);
    expect(normalizeNumber(DEF, "42")).toBe(42);
  });

  it("keeps any finite value when the def has no range", () => {
    const open = { ...DEF, min: undefined, max: undefined };
    expect(normalizeNumber(open, "-5")).toBe(-5);
    expect(normalizeNumber(open, "99999")).toBe(99999);
  });
});

describe("renderNumber", () => {
  beforeEach(() => {
    vi.mocked(chrome.storage.local.set).mockClear();
  });

  function mount(def: HubSettingDef, value: unknown): HTMLInputElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(renderNumber(def, value, true), root);
    return root.querySelector("input")!;
  }

  function change(input: HTMLInputElement, raw: string) {
    input.value = raw;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("saves a number, never the raw string, and shows what was stored", () => {
    const input = mount(DEF, 140);
    change(input, "");
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      LOGTIME_GOAL_HOURS: 140,
    });
    expect(input.value).toBe("140");

    change(input, "0");
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      LOGTIME_GOAL_HOURS: 1,
    });
    expect(input.value).toBe("1");

    change(input, "5000");
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      LOGTIME_GOAL_HOURS: 744,
    });
    expect(input.value).toBe("744");
  });

  it("does the same in the euro-suffixed variant", () => {
    const def: HubSettingDef = {
      ...DEF,
      key: "LOGTIME_EMOJI_DIVISOR",
      min: 0.1,
      max: undefined,
      defaultValue: 8.7,
    };
    const input = mount(def, 8.7);
    change(input, "0");
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      LOGTIME_EMOJI_DIVISOR: 0.1,
    });
    expect(input.value).toBe("0.1");
    change(input, "");
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      LOGTIME_EMOJI_DIVISOR: 8.7,
    });
  });
});

describe("Logtime number settings", () => {
  const byKey = (key: string) => LOGTIME_SETTINGS.find((d) => d.key === key)!;

  it("refuse the values the calendar divides by", () => {
    expect(byKey("LOGTIME_GOAL_HOURS").min).toBeGreaterThanOrEqual(1);
    expect(byKey("LOGTIME_EMOJI_DIVISOR").min).toBeGreaterThan(0);
    expect(byKey("LOGTIME_EMOJI_RATE").min).toBe(0);
    expect(byKey("LOGTIME_MAX_EARNINGS").min).toBe(0);
  });

  it("have a default inside their own range", () => {
    for (const def of LOGTIME_SETTINGS) {
      if (def.kind !== "number") continue;
      expect(normalizeNumber(def, String(def.defaultValue))).toBe(def.defaultValue);
    }
  });
});
