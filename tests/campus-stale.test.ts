/**
 * Stale-if-error for the campus caches: while the worker is down (or over its
 * quota), yesterday's campus list, campus file and cluster maps are served
 * instead of nothing. Forced loads (the hub's reload button) still fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCampusList, loadCampusData } from "../src/features/campus/campus";
import {
  getCachedCluster,
  setCachedCluster,
} from "../src/features/clusters/map-dialog/cache";

const HOUR = 60 * 60 * 1000;
const OLD_MANIFEST = { campuses: [{ id: "7", name: "Mulhouse" }] };
const OLD_DATA = { clusters: [{ id: "k0", name: "k0" }], definitions: {} };

let worker: "up" | "down" | "offline";

beforeEach(async () => {
  await chrome.storage.local.clear();
  worker = "down";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (worker === "offline") throw new TypeError("NetworkError");
      if (worker === "down") return { ok: false, status: 503, json: async () => ({}) };
      const body = url.endsWith("/campuses.json")
        ? { campuses: [{ id: "7", name: "Mulhouse" }, { id: "1", name: "Paris" }] }
        : { clusters: [{ id: "k1", name: "k1" }], definitions: {} };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function seedManifest(ageMs: number) {
  await chrome.storage.local.set({
    CAMPUS_MANIFEST_V2: { manifest: OLD_MANIFEST, timestamp: Date.now() - ageMs },
  });
}
async function seedData(ageMs: number) {
  await chrome.storage.local.set({
    CAMPUS_DATA_7: { data: OLD_DATA, timestamp: Date.now() - ageMs },
  });
}

describe("fetchCampusList", () => {
  it("serves an expired list when the worker fails (it threw before)", async () => {
    await seedManifest(25 * HOUR);
    await expect(fetchCampusList()).resolves.toEqual(OLD_MANIFEST);
    worker = "offline";
    await expect(fetchCampusList()).resolves.toEqual(OLD_MANIFEST);
  });

  it("still fails with nothing cached, or when forced", async () => {
    await expect(fetchCampusList()).rejects.toThrow();
    await seedManifest(25 * HOUR);
    await expect(fetchCampusList(true)).rejects.toThrow();
  });

  it("replaces an expired list when the worker answers", async () => {
    await seedManifest(2 * HOUR);
    worker = "up";
    const manifest = await fetchCampusList();
    expect(manifest.campuses).toHaveLength(2);
  });
});

describe("loadCampusData", () => {
  it("serves an expired campus file when the worker fails (it threw before)", async () => {
    await seedManifest(25 * HOUR);
    await seedData(25 * HOUR);
    await expect(loadCampusData("7")).resolves.toEqual(OLD_DATA);
    worker = "offline";
    await expect(loadCampusData("7")).resolves.toEqual(OLD_DATA);
  });

  it("still fails with nothing cached, or when forced", async () => {
    await expect(loadCampusData("7")).rejects.toThrow();
    await seedManifest(25 * HOUR);
    await seedData(25 * HOUR);
    await expect(loadCampusData("7", true)).rejects.toThrow();
  });

  it("replaces an expired campus file when the worker answers", async () => {
    await seedData(2 * HOUR);
    worker = "up";
    const data = await loadCampusData("7");
    expect(data.clusters[0].id).toBe("k1");
  });
});

describe("getCachedCluster", () => {
  it("returns an expired map only when asked to", async () => {
    await setCachedCluster("7", "k0", {
      svg: "<svg/>",
      seats: [],
      viewBox: { w: 1, h: 1 },
      cachedAt: 0,
    });
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 8 * 24 * HOUR);
    try {
      expect(await getCachedCluster("7", "k0")).toBeNull();
      expect((await getCachedCluster("7", "k0", { allowStale: true }))?.svg).toBe(
        "<svg/>",
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
});
