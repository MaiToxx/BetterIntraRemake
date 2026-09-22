/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The logtime widget's data-theme was read once at init: after the hub's
 * theme toggle restyled the page, the box kept the old theme until a reload.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../src/features/calendar/calendar-sync.ts", () => ({
  syncCalendarIcs: vi.fn(async () => {}),
}));

import { initLogtime } from "../src/features/logtime/logtime";
import { THEME_CHANGED_EVENT } from "../src/core/theme/theme-manager";

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
};

function themed(): HTMLElement | null {
  return (
    document
      .getElementById("logtime-shadow-wrapper")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-theme]") ?? null
  );
}

beforeAll(async () => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  await chrome.storage.local.set({
    CLOUD_LOGIN: "me",
    BETTER_INTRA_THEME: "light",
    LOGTIME_CALENDAR_VIEW: "normal",
  });
  (globalThis as any).fetch = vi.fn(async () => new Response("{}", { status: 404 }));

  const grid = document.createElement("div");
  const card = document.createElement("div");
  card.className = "bg-white md:h-96";
  card.textContent = "LOGTIME";
  grid.appendChild(card);
  document.body.appendChild(grid);

  await initLogtime();
  document.dispatchEvent(
    new CustomEvent("42_LOGTIME_DATA", { detail: { "2026-09-01": "01:00:00" } }),
  );
  await flush();
});

describe("logtime follows the theme toggle", () => {
  it("re-renders with the new theme without a reload", async () => {
    expect(themed()?.getAttribute("data-theme")).toBe("light");

    document.dispatchEvent(
      new CustomEvent(THEME_CHANGED_EVENT, { detail: { theme: "dark", preset: "dark" } }),
    );
    await flush();
    expect(themed()?.getAttribute("data-theme")).toBe("dark");
  });
});
