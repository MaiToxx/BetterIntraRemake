/**
 * The belt-and-braces guard of src/core/config/snapshot.ts (docs/CODE-SPLITTING.md,
 * rule 5): the storage write wrapper is marked with
 * Symbol.for("better-intra.config.wrapper"), so that a second instance of the
 * module in the same realm (which the split content script must never
 * create) finds the methods already wrapped and stays on direct reads
 * instead of wrapping them a second time.
 */
import { describe, it, expect, afterAll, vi } from "vitest";

const setupChrome = (globalThis as { chrome?: unknown }).chrome;
afterAll(() => {
  (globalThis as { chrome?: unknown }).chrome = setupChrome;
});

function mockChrome() {
  const store = new Map<string, unknown>();
  const get = vi.fn(async (keys: string | string[]) => {
    const out: Record<string, unknown> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) out[key] = store.get(key);
    return out;
  });
  const set = vi.fn(async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) store.set(key, value);
  });
  const remove = vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
  });
  const clear = vi.fn(async () => store.clear());
  const addListener = vi.fn();
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: "better-intra" },
    storage: {
      local: { get, set, remove, clear },
      onChanged: { addListener, removeListener: vi.fn() },
    },
  };
  return { get, set, remove, clear, addListener };
}

type Marked = Record<symbol, unknown>;
const local = () => chrome.storage.local as unknown as Record<"set" | "remove" | "clear", Marked>;

describe("snapshot write wrapper guard", () => {
  it("marks the three wrappers it installs with a registry symbol", async () => {
    const raw = mockChrome();
    vi.resetModules();
    const { WRITE_WRAPPER_MARK } = await import("../src/core/config/snapshot.ts");
    await import("../src/core/config.ts");

    expect(WRITE_WRAPPER_MARK).toBe(Symbol.for("better-intra.config.wrapper"));
    for (const method of ["set", "remove", "clear"] as const) {
      expect(local()[method]).not.toBe(raw[method]);
      expect(local()[method][WRITE_WRAPPER_MARK]).toBe(true);
      expect((raw[method] as unknown as Marked)[WRITE_WRAPPER_MARK]).toBeUndefined();
    }
    expect(raw.addListener).toHaveBeenCalledTimes(1);
  });

  it("a second instance does not wrap again: it reads storage directly", async () => {
    const raw = mockChrome();
    vi.resetModules();
    const first = await import("../src/core/config.ts");
    const wrapped = { set: local().set, remove: local().remove, clear: local().clear };

    vi.resetModules();
    const second = await import("../src/core/config.ts");
    // Same wrappers as before, not wrappers of wrappers, and no second listener.
    expect(local().set).toBe(wrapped.set);
    expect(local().remove).toBe(wrapped.remove);
    expect(local().clear).toBe(wrapped.clear);
    expect(raw.addListener).toHaveBeenCalledTimes(1);

    // The first instance keeps its snapshot: one bulk read for many keys.
    raw.get.mockClear();
    await first.getConfig("LOGTIME_GOAL_HOURS");
    await first.getConfig("LOGTIME_EMOJI");
    expect(raw.get).toHaveBeenCalledTimes(1);

    // The second one has none: every read is the direct get.
    raw.get.mockClear();
    await second.getConfig("LOGTIME_GOAL_HOURS");
    await second.getConfig("LOGTIME_GOAL_HOURS");
    expect(raw.get).toHaveBeenCalledTimes(2);

    // A write goes through the one wrapper once, and both instances read it back.
    await chrome.storage.local.set({ LOGTIME_GOAL_HOURS: 99 });
    expect(raw.set).toHaveBeenCalledTimes(1);
    raw.get.mockClear();
    expect(await first.getConfig("LOGTIME_GOAL_HOURS")).toBe(99);
    expect(raw.get).toHaveBeenCalledTimes(0); // from the snapshot the wrapper updated
    expect(await second.getConfig("LOGTIME_GOAL_HOURS")).toBe(99);
    expect(raw.get).toHaveBeenCalledTimes(1);
  });
});
