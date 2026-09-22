/**
 * The title badge URLs come from the campus file that the campus module
 * already caches (CAMPUS_DATA_<id>). badges.ts used to fetch that same file
 * again under its own key: one extra worker request and storage read on every
 * dashboard load, and null (never cached) on a campus without badges.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** The badge memo is per page (module state): a fresh module per test. */
async function loadModule() {
  vi.resetModules();
  return import("../src/features/profile/header/badges.ts");
}

const CAMPUS = { clusters: [], definitions: {} };

async function seedCampus(data: object) {
  await chrome.storage.local.set({
    CLUSTERS_CAMPUS: "7",
    CAMPUS_MANIFEST_V2: {
      manifest: { campuses: [{ id: "7", name: "Mulhouse" }] },
      timestamp: Date.now(),
    },
    CAMPUS_DATA_7: { data, timestamp: Date.now() },
  });
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => CAMPUS })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("getBadgeUrl", () => {
  it("resolves from the cached campus file without a fetch", async () => {
    const { getBadgeUrl } = await loadModule();
    await seedCampus({
      ...CAMPUS,
      badgeBaseUrl: "https://cdn.example.com/badges/{name}.svg",
      badges: { SLOTS: "slots" },
    });
    await expect(getBadgeUrl("SLOTS")).resolves.toBe(
      "https://cdn.example.com/badges/slots.svg",
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("answers null for a campus without badges, still without a fetch", async () => {
    const { getBadgeUrl } = await loadModule();
    await seedCampus(CAMPUS);
    await expect(getBadgeUrl("SLOTS")).resolves.toBeNull();
    await expect(getBadgeUrl("OTHER")).resolves.toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("answers null when the campus file cannot be loaded", async () => {
    const { getBadgeUrl } = await loadModule();
    await chrome.storage.local.set({ CLUSTERS_CAMPUS: "7" });
    vi.mocked(fetch).mockImplementation(async () => {
      throw new TypeError("NetworkError");
    });
    await expect(getBadgeUrl("SLOTS")).resolves.toBeNull();
  });
});
