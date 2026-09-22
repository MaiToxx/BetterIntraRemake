/**
 * Writing the profile stats cache used to scan the whole storage area once per
 * page (chrome.storage.local.get(null)) for keys older builds left behind.
 * That copy of every stored byte into the tab now happens in the background,
 * once per update; the card's path only touches its own key.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PROFILE_STATS_CACHE_KEY,
  writeProfileStatsCache,
} from "../src/features/profile/cards/profile-stats-intra";

describe("writeProfileStatsCache", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    vi.mocked(chrome.storage.local.get).mockClear();
  });

  it("reads and writes its own key only, never the whole storage area", async () => {
    await chrome.storage.local.set({ FT_PROFILE_STATS_alice: { at: 1, data: {} }, OTHER: 1 });
    await writeProfileStatsCache("bob", { roulette: [], evalStats: null }, 1000);
    await writeProfileStatsCache("carol", { roulette: [], evalStats: null }, 2000);

    const keysAsked = vi.mocked(chrome.storage.local.get).mock.calls.map((c) => c[0]);
    expect(keysAsked).not.toContain(null);
    expect(keysAsked).not.toContain(undefined);
    expect(keysAsked.every((k) => k === PROFILE_STATS_CACHE_KEY)).toBe(true);
    // other keys are none of its business
    const store = await chrome.storage.local.get(null);
    expect(store.OTHER).toBe(1);
    expect(store.FT_PROFILE_STATS_alice).toBeDefined();
  });
});
