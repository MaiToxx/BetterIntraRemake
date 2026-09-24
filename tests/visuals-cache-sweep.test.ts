/**
 * Other students' visuals stored locally (visuals_cache_<login>) are swept:
 * a record not written for a month goes, and the oldest go beyond a cap.
 * They used to stay for the life of the install, bio and links included.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/features/account/account.ts", () => ({ getCloudLogin: async () => null }));

const DAY = 24 * 60 * 60 * 1000;

async function loadCache() {
  vi.resetModules();
  return import("../src/features/profile/header/visuals-cache.ts");
}

const record = (fetchedAt?: number) => ({ avatar: "https://img.example/a.png", fetchedAt });

const cacheKeys = async () =>
  Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith("visuals_cache_"));

beforeEach(async () => {
  await chrome.storage.local.clear();
  vi.mocked(chrome.storage.local.get).mockClear();
});

describe("sweepVisualsCache", () => {
  it("drops records older than a month or without a stamp, and keeps the rest and other keys", async () => {
    const { sweepVisualsCache } = await loadCache();
    const now = Date.now();
    await chrome.storage.local.set({
      visuals_cache_old: record(now - 31 * DAY),
      visuals_cache_nostamp: record(),
      visuals_cache_recent: record(now - 2 * DAY),
      CLUSTERS_CAMPUS: "7",
    });

    await sweepVisualsCache(now);

    expect(await cacheKeys()).toEqual(["visuals_cache_recent"]);
    expect((await chrome.storage.local.get("CLUSTERS_CAMPUS")).CLUSTERS_CAMPUS).toBe("7");
  });

  it("keeps the newest records beyond the cap", async () => {
    const { sweepVisualsCache, VISUALS_CACHE_MAX_ENTRIES } = await loadCache();
    const now = Date.now();
    const items: Record<string, unknown> = {};
    for (let i = 0; i < VISUALS_CACHE_MAX_ENTRIES + 5; i++) {
      items[`visuals_cache_u${i}`] = record(now - i * 1000);
    }
    await chrome.storage.local.set(items);

    await sweepVisualsCache(now);

    const kept = await cacheKeys();
    expect(kept).toHaveLength(VISUALS_CACHE_MAX_ENTRIES);
    expect(kept).toContain("visuals_cache_u0");
    expect(kept).not.toContain(`visuals_cache_u${VISUALS_CACHE_MAX_ENTRIES}`);
  });

  it("runs at most once a day", async () => {
    const { sweepVisualsCache } = await loadCache();
    const now = Date.now();
    await sweepVisualsCache(now);
    await chrome.storage.local.set({ visuals_cache_old: record(now - 40 * DAY) });

    await sweepVisualsCache(now + DAY / 2);
    expect(await cacheKeys()).toEqual(["visuals_cache_old"]);

    await sweepVisualsCache(now + DAY + 1);
    expect(await cacheKeys()).toEqual([]);
  });

  it("lists the keys with getKeys() where the browser has it, without reading every value", async () => {
    const { sweepVisualsCache } = await loadCache();
    const now = Date.now();
    await chrome.storage.local.set({
      visuals_cache_old: record(now - 40 * DAY),
      CAMPUS_DATA_7: { data: "a big campus file" },
    });
    const local = chrome.storage.local as unknown as { getKeys?: () => Promise<string[]> };
    local.getKeys = vi.fn(async () => ["visuals_cache_old", "CAMPUS_DATA_7"]);
    try {
      await sweepVisualsCache(now);
    } finally {
      delete local.getKeys;
    }
    expect(vi.mocked(chrome.storage.local.get).mock.calls.some(([k]) => k === null)).toBe(false);
    expect(await cacheKeys()).toEqual([]);
  });
});

describe("setCachedVisuals", () => {
  it("sweeps once per page, on the first write", async () => {
    const { setCachedVisuals } = await loadCache();
    await chrome.storage.local.set({ visuals_cache_old: record(Date.now() - 40 * DAY) });

    setCachedVisuals("bob", { avatar: "https://img.example/b.png" });
    await vi.waitFor(async () => expect(await cacheKeys()).toEqual(["visuals_cache_bob"]));
    const stampReads = () =>
      vi.mocked(chrome.storage.local.get).mock.calls.filter(
        ([k]) => k === "VISUALS_CACHE_SWEPT_AT",
      ).length;
    expect(stampReads()).toBe(1);

    setCachedVisuals("carol", { avatar: "https://img.example/c.png" });
    await vi.waitFor(async () => expect(await cacheKeys()).toHaveLength(2));
    expect(stampReads()).toBe(1);
  });
});
