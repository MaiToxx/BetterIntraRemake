/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The profile page, where the widget mounts. Two things the init owes it:
 * the browser's scroll restoration is paused only while the widget is
 * mounted and scrolled to the latest month, then handed back; and values an
 * older hub stored as "" or 0 (the calendar divides by them) read as the
 * defaults instead of printing "NaN%" or "Infinity 🌮".
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../src/features/calendar/calendar-sync.ts", () => ({
  syncCalendarIcs: vi.fn(async () => {}),
}));

import { initLogtime } from "../src/features/logtime/logtime";
import { CONFIG_DEFAULT } from "../src/core/config";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function root(): ShadowRoot {
  return document.getElementById("logtime-shadow-wrapper")!.shadowRoot!;
}

beforeAll(async () => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  (globalThis as any).fetch = vi.fn(async () => new Response("{}", { status: 404 }));
  Object.defineProperty(history, "scrollRestoration", {
    value: "auto",
    writable: true,
    configurable: true,
  });
  const grid = document.createElement("div");
  const card = document.createElement("div");
  card.className = "bg-white md:h-96";
  card.textContent = "LOGTIME";
  grid.appendChild(card);
  document.body.appendChild(grid);
  await chrome.storage.local.set({
    LOGTIME_CALENDAR_VIEW: "normal",
    LOGTIME_SHOW_GOAL: true,
    LOGTIME_SHOW_TACOS: true,
    LOGTIME_GOAL_HOURS: "",
    LOGTIME_EMOJI_DIVISOR: 0,
    LOGTIME_EMOJI_RATE: -3,
    LOGTIME_MAX_EARNINGS: "",
  });
});

describe("initLogtime on the profile page", () => {
  it("pauses scroll restoration only until the widget has scrolled to the latest month", async () => {
    await initLogtime();
    expect(history.scrollRestoration).toBe("manual");

    document.dispatchEvent(
      new CustomEvent("42_LOGTIME_DATA", {
        detail: { "2026-08-03": "02:00:00", "2026-09-20": "03:00:00" },
      }),
    );
    // the widget's scroll-to-latest settles 100ms after the render; under a
    // loaded test runner that render itself can take a while
    for (let i = 0; i < 100 && history.scrollRestoration !== "auto"; i++) {
      await wait(30);
    }
    expect(root().querySelectorAll(".month-card").length).toBeGreaterThan(0);
    expect(history.scrollRestoration).toBe("auto");
  });

  it("reads a stored 0 or \"\" as the default where the calendar divides", () => {
    const text = root().textContent || "";
    expect(text).not.toMatch(/Infinity|NaN/);
    expect(text).toContain(`/ ${CONFIG_DEFAULT.LOGTIME_GOAL_HOURS}h`);
  });
});
