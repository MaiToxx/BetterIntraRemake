/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/users/bob" }
 *
 * The two looping animations the extension puts in the page itself (outside
 * any shadow root, where the shared no-motion sheet cannot reach): the freeze
 * card's spinning icon and the seat highlight's pulse. Both must stop for the
 * system's reduce-motion preference and for "Disable animations"; the seat
 * keeps a still glow so it can still be found.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 2));
};

beforeAll(async () => {
  await chrome.storage.local.set({
    DISABLE_ANIMATIONS: true,
    FREEZE_CACHE: JSON.stringify({ bob: FUTURE }),
  });
  sessionStorage.setItem("ft_intrapy_token", "token");
});

describe("freeze card icon", () => {
  it("spins through a class the motion settings can stop", async () => {
    const row = document.createElement("div");
    row.className = "flex flex-col lg:flex-row gap-6 md:gap-8";
    const profileCard = document.createElement("div");
    profileCard.id = "profile-card";
    row.appendChild(profileCard);
    document.body.appendChild(row);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [{ freeze_until: FUTURE }] })),
    );

    const { initFreezeCard } = await import("../src/features/profile/cards/freeze.ts");
    await initFreezeCard();
    await flush();

    const icon = document.querySelector<HTMLElement>("#ft-freeze-card .ft-freeze-spin");
    expect(icon).not.toBeNull();
    // an inline animation would beat every stylesheet rule below
    expect(icon!.style.animation).toBe("");
    const css = document.getElementById("ft-freeze-spin-style")!.textContent!;
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.ft-freeze-spin \{ animation: none; \} \}/);
    expect(css).toContain("html.ft-freeze-still .ft-freeze-spin { animation: none; }");
    // DISABLE_ANIMATIONS is on
    expect(document.documentElement.classList.contains("ft-freeze-still")).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe("seat highlight pulse", () => {
  it("is replaced by a still glow", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await import("../src/features/profile/layout/highlight.ts");
    for (let i = 0; i < 100 && !document.getElementById("ft-glow-styles"); i++) await flush(1);
    const css = document.getElementById("ft-glow-styles")!.textContent!;
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ft-glowing-seat\s*\{\s*animation: none !important;\s*filter: drop-shadow/);
    expect(css).toMatch(/html\.ft-glow-still \.ft-glowing-seat\s*\{\s*animation: none !important;\s*filter: drop-shadow/);
    await flush();
    expect(document.documentElement.classList.contains("ft-glow-still")).toBe(true);
    vi.unstubAllGlobals();
  });
});
