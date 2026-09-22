/**
 * Stale-while-revalidate for the campus file: once an hour the storage cache
 * and the worker's HTTP cache lapsed together, and every Intra page waited for
 * two worker round trips (manifest, then campus file) before any feature
 * started. An expired copy is now served at once and refreshed in the
 * background; only a cold install (nothing cached) waits for the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ensureCampusData, loadCampusData } from "../src/features/campus/campus.ts";
import * as campus from "../src/features/campus/campus.ts";

const HOUR = 60 * 60 * 1000;
const OLD_MANIFEST = { campuses: [{ id: "7", name: "Mulhouse" }] };
const OLD_DATA = { clusters: [{ id: "k0", name: "k0" }], definitions: {} };
const NEW_DATA = { clusters: [{ id: "k1", name: "k1" }], definitions: {} };

/** A worker that answers only when the test says so. */
let release: () => void;
let gate: Promise<void>;

beforeEach(async () => {
  await chrome.storage.local.clear();
  gate = new Promise<void>((r) => (release = r));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      await gate;
      const body = url.endsWith("/campuses.json") ? OLD_MANIFEST : NEW_DATA;
      return { ok: true, status: 200, json: async () => body };
    }),
  );
  (chrome.storage as { onChanged?: unknown }).onChanged ??= {
    addListener: () => {},
    removeListener: () => {},
  };
});
afterEach(() => vi.unstubAllGlobals());

async function seedExpired() {
  await chrome.storage.local.set({
    CLUSTERS_CAMPUS: "7",
    CAMPUS_MANIFEST_V2: { manifest: OLD_MANIFEST, timestamp: Date.now() - 2 * HOUR },
    CAMPUS_DATA_7: { data: OLD_DATA, timestamp: Date.now() - 2 * HOUR },
  });
}

/** Resolves to "settled" or "pending" without waiting on the promise. */
const state = (p: Promise<unknown>) =>
  Promise.race([p.then(() => "settled"), Promise.resolve("pending")]);

describe("loadCampusData with an expired cache", () => {
  it("serves the expired copy at once and refreshes it in the background", async () => {
    await seedExpired();
    const data = await loadCampusData("7");
    // Before: this awaited the two fetches, i.e. never resolved here.
    expect(data.clusters[0].id).toBe("k0");
    expect(fetch).toHaveBeenCalled();

    release();
    await vi.waitFor(async () => {
      const stored = await chrome.storage.local.get("CAMPUS_DATA_7");
      expect(stored.CAMPUS_DATA_7.data.clusters[0].id).toBe("k1");
    });
  });

  it("still waits for the network on a cold install, and on a forced load", async () => {
    const cold = loadCampusData("7");
    await chrome.storage.local.set({
      CAMPUS_MANIFEST_V2: { manifest: OLD_MANIFEST, timestamp: Date.now() },
    });
    expect(await state(cold)).toBe("pending");
    release();
    expect((await cold).clusters[0].id).toBe("k1");

    await seedExpired();
    expect((await loadCampusData("7", true)).clusters[0].id).toBe("k1");
  });

  it("ensureCampusData resolves before the worker answers, then picks up the fresh list", async () => {
    await seedExpired();
    await ensureCampusData();
    expect(campus.CLUSTERS[0].id).toBe("k0");
    // One load in flight for the lot, however many callers joined.
    expect(vi.mocked(fetch).mock.calls.filter(([u]) => u.endsWith("/campuses.json"))).toHaveLength(1);

    release();
    await vi.waitFor(() => expect(campus.CLUSTERS[0].id).toBe("k1"));
  });
});

describe("main.ts", () => {
  it("does not hold the feature loop behind the campus data", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf8");
    expect(src).not.toMatch(/await\s+ensureCampusData\(/);
  });
});
