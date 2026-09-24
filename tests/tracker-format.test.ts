import { describe, it, expect } from "vitest";
import { formatHours, trackerStateFor, TRACKER_MODES } from "../src/features/logtime/tracker";
import { sanitizeHttpUrl } from "../src/core/security/safe-url";
import { getActiveFeatures } from "../src/features/hub/hubSettings.storage.ts";

describe("formatHours", () => {
  it("never renders 60 minutes", () => {
    // 4h59m45s used to give "4h60"
    expect(formatHours(4 + 59.75 / 60)).toBe("5h");
    expect(formatHours(4.5)).toBe("4h30");
    expect(formatHours(0)).toBe("0h");
    expect(formatHours(2 + 5 / 60)).toBe("2h05");
  });
});

describe("trackerStateFor", () => {
  // the badge popover and the stored mode read the same table (it had a copy)
  it("knows the nine phases, and neither off nor a name every object inherits", () => {
    expect(TRACKER_MODES).toHaveLength(9);
    expect(trackerStateFor("pegasus-gold")).toMatchObject({
      label: "Pegasus - Gold",
      thresholds: { days: 5, hours: 40 },
    });
    expect(trackerStateFor("off")).toBeNull();
    expect(trackerStateFor("toString")).toBeNull();
  });
});

describe("sanitizeHttpUrl", () => {
  it("keeps absolute http(s) URLs and rejects the rest", () => {
    expect(sanitizeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(sanitizeHttpUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeHttpUrl("example.com")).toBe("");
    expect(sanitizeHttpUrl(null)).toBe("");
  });
});

describe("getActiveFeatures", () => {
  it("keeps an explicitly empty list instead of re-enabling everything", async () => {
    await chrome.storage.local.set({ ACTIVE_SCRIPTS: [] });
    expect(await getActiveFeatures()).toEqual([]);
  });

  it("falls back to every feature when the stored value is garbage", async () => {
    await chrome.storage.local.set({ ACTIVE_SCRIPTS: "not json" });
    expect((await getActiveFeatures()).length).toBeGreaterThan(0);
  });
});
