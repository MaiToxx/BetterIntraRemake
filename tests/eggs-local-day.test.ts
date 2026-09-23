/**
 * The time-based easter eggs are remembered per local day ("ft-egg-thursday",
 * "ft-egg-night") and per local month ("ft-egg-42"). The keys used to come
 * from toISOString(), the UTC day, while the checks read the local weekday and
 * hour: in Paris a Thursday opened before 02:00 was stored under Wednesday's
 * date, so the Thursday toast came back later that same day, and the 42h
 * month badge on the 1st before 02:00 counted for the previous month.
 */
// Paris is UTC+2 in September: local 00:30 is 22:30 UTC the day before. Same
// precedent as tests/validators.test.ts.
process.env.TZ = "Europe/Paris";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function startEggsAt(local: Date) {
  vi.setSystemTime(local);
  history.replaceState({}, "", "/");
  vi.resetModules();
  const { initEasterEggs } = await import("../src/features/eggs/eggs.ts");
  await initEasterEggs();
}

beforeEach(async () => {
  vi.useFakeTimers();
  await chrome.storage.local.clear();
  localStorage.clear();
  document.body.replaceChildren();
  // Reduced motion: the 42h hit would otherwise throw confetti on a canvas
  // jsdom cannot draw.
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
  }));
});

afterEach(() => {
  // stops the badge and title watchers (dom-wait listens for pagehide)
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("easter egg day keys follow the local calendar", () => {
  it("credits a Thursday opened at 00:30 to that Thursday", async () => {
    const thursday = new Date(2026, 8, 24, 0, 30);
    expect(thursday.getDay()).toBe(4);
    await startEggsAt(thursday);

    const card = document.createElement("div");
    card.dataset.ftCard = "roulette";
    const title = document.createElement("div");
    title.className = "font-bold uppercase text-sm";
    title.textContent = "Thursday Roulette";
    card.appendChild(title);
    document.body.appendChild(card);

    await vi.waitFor(() => expect(title.textContent).toBe("🎰 Thursday Roulette"));
    expect(localStorage.getItem("ft-egg-thursday")).toBe("2026-09-24");
  });

  it("counts a 42h00 month badge seen at 00:30 on the 1st for the new month", async () => {
    const host = document.createElement("div");
    host.id = "logtime-shadow-wrapper";
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "42h00";
    root.appendChild(badge);

    await startEggsAt(new Date(2026, 9, 1, 0, 30));

    await vi.waitFor(() => expect(localStorage.getItem("ft-egg-42")).not.toBeNull());
    expect(localStorage.getItem("ft-egg-42")).toBe("2026-10");
  });
});
