/**
 * Thirteen campuses have no data file. The worker's 404 was asked again on
 * every page, and the profile start-up waited for it: the answer is now kept
 * for the hour a file would be. A hanging worker times out instead of holding
 * the start-up with no limit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadCampusData, clearCampusConfigCache } from "../src/features/campus/campus";

const MANIFEST = { campuses: [{ id: "9", name: "Lyon" }] };
let fileCalls = 0;
let fileStatus = 404;

beforeEach(async () => {
  await chrome.storage.local.clear();
  fileCalls = 0;
  fileStatus = 404;
  await chrome.storage.local.set({ CAMPUS_MANIFEST_V2: { manifest: MANIFEST, timestamp: Date.now() } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/campuses.json")) return new Response(JSON.stringify(MANIFEST));
      fileCalls++;
      return fileStatus === 200
        ? new Response(JSON.stringify({ clusters: [{ id: "a", name: "a1" }], definitions: {} }))
        : new Response("Not found", { status: fileStatus });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a campus without a data file", () => {
  it("is asked once an hour, not on every page", async () => {
    await expect(loadCampusData("9")).rejects.toThrow();
    await expect(loadCampusData("9")).rejects.toThrow(/No campus data for 9/);
    expect(fileCalls).toBe(1);
  });

  it("a forced load (the hub's reload) asks again, and clearing the cache forgets the 404", async () => {
    await expect(loadCampusData("9")).rejects.toThrow();
    fileStatus = 200;
    await expect(loadCampusData("9", true)).resolves.toMatchObject({ clusters: [{ id: "a" }] });
    expect(fileCalls).toBe(2);
    await clearCampusConfigCache("9");
    expect((await chrome.storage.local.get("CAMPUS_MISSING_9")).CAMPUS_MISSING_9).toBeUndefined();
  });

  it("a server error is not remembered as missing", async () => {
    fileStatus = 503;
    await expect(loadCampusData("9")).rejects.toThrow();
    await expect(loadCampusData("9")).rejects.toThrow();
    expect(fileCalls).toBe(2);
  });

  it("a hanging worker times out after 10 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) =>
            init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
          ),
      ),
    );
    const load = loadCampusData("9");
    const settled = expect(load).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
  });
});
