/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The Logtime tab of the hub opens over the widget, and every one of its
 * settings used to say "reload to apply": the widget read them once, at init.
 * It now re-reads them on a storage change and renders again.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../src/features/calendar/calendar-sync.ts", () => ({
  syncCalendarIcs: vi.fn(async () => {}),
}));

type Changed = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const listeners: Changed[] = [];
(chrome.storage as unknown as { onChanged: unknown }).onChanged = {
  addListener: (fn: Changed) => listeners.push(fn),
};

/** chrome.storage.local.set() plus the onChanged event the browser sends. */
async function setAndNotify(values: Record<string, unknown>) {
  await chrome.storage.local.set(values);
  const changes = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { newValue: v }]));
  for (const fn of listeners) fn(changes, "local");
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
};

const widgetHtml = () =>
  document.getElementById("logtime-shadow-wrapper")?.shadowRoot?.innerHTML ?? "";

beforeAll(async () => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  await chrome.storage.local.set({
    CLOUD_LOGIN: "me",
    LOGTIME_CALENDAR_VIEW: "normal",
    LOGTIME_CALENDAR_COLOR: "#00babc",
  });
  (globalThis as any).fetch = vi.fn(async () => new Response("{}", { status: 404 }));

  const grid = document.createElement("div");
  const card = document.createElement("div");
  card.className = "bg-white md:h-96";
  card.textContent = "LOGTIME";
  grid.appendChild(card);
  document.body.appendChild(grid);

  const { initLogtime } = await import("../src/features/logtime/logtime");
  await initLogtime();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  document.dispatchEvent(new CustomEvent("42_LOGTIME_DATA", { detail: { [today]: "12:00:00" } }));
  await flush();
});

describe("Logtime settings apply while the page is open", () => {
  it("re-renders with a new calendar colour", async () => {
    expect(widgetHtml()).toContain("rgba(0, 186, 188");
    await setAndNotify({ LOGTIME_CALENDAR_COLOR: "#ff0000" });
    await flush();
    expect(widgetHtml()).toContain("rgba(255, 0, 0");
    expect(widgetHtml()).not.toContain("rgba(0, 186, 188");
  });

  it("takes the streak badge away with Show streak off, and brings it back", async () => {
    const badge = () =>
      document
        .getElementById("logtime-shadow-wrapper")
        ?.shadowRoot?.querySelector(".lt-records-badge");
    expect(badge()).toBeTruthy();
    await setAndNotify({ LOGTIME_SHOW_RECORDS: false });
    await flush();
    expect(badge()).toBeFalsy();
    await setAndNotify({ LOGTIME_SHOW_RECORDS: true });
    await flush();
    expect(badge()).toBeTruthy();
  });

  it("ignores keys it does not own", async () => {
    const before = widgetHtml();
    await setAndNotify({ CUSTOM_FONT: "mono" });
    await flush();
    expect(widgetHtml()).toBe(before);
  });
});
