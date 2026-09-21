/**
 * The settings snapshot in src/core/config.ts: one storage read per context instead
 * of one per getConfig(), and never a stale value.
 *
 * Each test builds its own chrome mock (with or without storage.onChanged) and
 * loads a fresh copy of the module, because the module decides at evaluation
 * time whether it can keep a snapshot. The shared mock in tests/setup.ts has no
 * onChanged, so every other suite runs the fallback path (direct reads); the
 * "fallback" block below pins that path too.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import type { ConfigKey } from "../src/core/config";

type Change = { oldValue?: unknown; newValue?: unknown };
type Listener = (changes: Record<string, Change>, area: string) => void;
type ConfigModule = typeof import("../src/core/config");

const setupChrome = (globalThis as { chrome?: unknown }).chrome;
afterAll(() => {
  (globalThis as { chrome?: unknown }).chrome = setupChrome;
});

interface BootOptions {
  /** Values already in storage. */
  initial?: Record<string, unknown>;
  /** Provide storage.onChanged (default true). */
  onChanged?: boolean;
  /** How the fake storage reports a write: never, or on a later task (default). */
  emitOnWrite?: "never" | "later";
  /** chrome.runtime.id; null leaves chrome.runtime out (orphaned script). */
  runtimeId?: string | null;
  /** Freeze storage.local so that its methods cannot be wrapped. */
  frozenArea?: boolean;
}

async function boot(opts: BootOptions = {}) {
  const store = new Map<string, unknown>(Object.entries(structuredClone(opts.initial ?? {})));
  const listeners: Listener[] = [];
  const emit = (changes: Record<string, Change>, area = "local") => {
    for (const listener of listeners.slice()) listener(changes, area);
  };
  const report = (changes: Record<string, Change>) => {
    if ((opts.emitOnWrite ?? "later") === "never") return;
    if (Object.keys(changes).length === 0) return;
    setTimeout(() => emit(changes), 0);
  };

  const get = vi.fn(async (keys: string | string[] | null) => {
    if (keys === null || keys === undefined) return Object.fromEntries(store);
    if (typeof keys === "string") return { [keys]: store.get(keys) };
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = store.get(key);
    return out;
  });
  const set = vi.fn(async (items: Record<string, unknown>, _cb?: () => void) => {
    const changes: Record<string, Change> = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: store.get(key), newValue: value };
      store.set(key, value);
    }
    report(changes);
  });
  const remove = vi.fn(async (keys: string | string[]) => {
    const changes: Record<string, Change> = {};
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      if (!store.has(key)) continue;
      changes[key] = { oldValue: store.get(key) };
      store.delete(key);
    }
    report(changes);
  });
  const clear = vi.fn(async () => {
    const changes: Record<string, Change> = {};
    for (const [key, value] of store) changes[key] = { oldValue: value };
    store.clear();
    report(changes);
  });

  const local = { get, set, remove, clear };
  if (opts.frozenArea) Object.freeze(local);
  const addListener = vi.fn((listener: Listener) => listeners.push(listener));
  (globalThis as { chrome?: unknown }).chrome = {
    ...(opts.runtimeId === null
      ? {}
      : { runtime: { id: opts.runtimeId ?? "test-extension" } }),
    storage: {
      local,
      ...(opts.onChanged === false
        ? {}
        : { onChanged: { addListener, removeListener: vi.fn() } }),
    },
  };

  vi.resetModules();
  const cfg: ConfigModule = await import("../src/core/config");
  return {
    cfg,
    store,
    /** The raw storage mocks, underneath any wrapper the module installed. */
    get,
    set,
    remove,
    clear,
    local,
    addListener,
    /** Fire storage.onChanged as another context (popup, worker, tab) would. */
    emit,
    gets: () => get.mock.calls.length,
  };
}

/** Let the fake storage deliver its onChanged events (they come on a later task). */
const nextTask = () => new Promise((r) => setTimeout(r, 0));

describe("settings snapshot: reads", () => {
  it("serves reads of many different keys from one keyed storage read", async () => {
    const h = await boot({
      initial: {
        LOGTIME_GOAL_HOURS: 120,
        LOGTIME_EMOJI: "🍕",
        ACTIVE_SCRIPTS: '["logtime","profile"]',
        PROFILE_CARD_ORDER: ["LOGTIME"],
        cluster_svg_1_2: "x".repeat(200_000),
      },
    });
    const { getConfig, getConfigMany, CONFIG_DEFAULT } = h.cfg;

    expect(await getConfig("LOGTIME_GOAL_HOURS")).toBe(120);
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕");
    expect(await getConfig("ACTIVE_SCRIPTS")).toEqual(["logtime", "profile"]);
    const order = await getConfig("PROFILE_CARD_ORDER");
    expect(order[0]).toBe("LOGTIME");
    expect(order).toHaveLength(CONFIG_DEFAULT.PROFILE_CARD_ORDER.length);
    expect(await getConfig("CLUSTERS_CAMPUS")).toBe("");
    expect(await getConfig("PROFILE_SHOW_MARKS")).toBe(true);
    expect(await getConfig("FRIENDS_LIST")).toEqual([]);
    expect(await getConfig("LAST_CLOUD_SYNC")).toBeNull();
    const many = await getConfigMany(["LOGTIME_EMOJI", "CUSTOM_FONT", "PERF_PRECONNECT"] as const);
    expect(many).toEqual({ LOGTIME_EMOJI: "🍕", CUSTOM_FONT: "default", PERF_PRECONNECT: true });

    expect(h.gets()).toBe(1);
    // The config keys only: the big caches in the same area are not dragged in.
    const [keys] = h.get.mock.calls[0];
    expect(keys).toEqual(Object.keys(CONFIG_DEFAULT));
    expect(keys).not.toContain("cluster_svg_1_2");
  });

  it("falls back to CONFIG_DEFAULT for every never-written key, and keeps a stored null", async () => {
    const h = await boot({ initial: { ACCOUNT: null, LOGTIME_GOAL_HOURS: 0, CUSTOM_CSS: "" } });
    const { getConfig, getConfigMany, CONFIG_DEFAULT } = h.cfg;
    const keys = Object.keys(CONFIG_DEFAULT) as ConfigKey[];

    const all = await getConfigMany(keys);
    expect(all).toEqual({ ...CONFIG_DEFAULT, ACCOUNT: null, LOGTIME_GOAL_HOURS: 0, CUSTOM_CSS: "" });
    for (const key of keys) {
      const expected = key === "LOGTIME_GOAL_HOURS" ? 0 : CONFIG_DEFAULT[key];
      expect(await getConfig(key)).toEqual(expected);
    }
    expect(h.gets()).toBe(1);
  });

  it("shares a single storage read between concurrent callers", async () => {
    const h = await boot({ initial: { LOGTIME_EMOJI: "🍕" } });
    const { getConfig, getConfigMany } = h.cfg;
    const results = await Promise.all([
      getConfig("LOGTIME_EMOJI"),
      getConfig("LOGTIME_GOAL_HOURS"),
      getConfig("PROFILE_THEME_PRESET"),
      getConfig("CLUSTERS_CAMPUS"),
      getConfigMany(["LOGTIME_EMOJI", "LOGTIME_SHOW_GOAL"] as const),
      getConfigMany(["PERF_LAZY_IMAGES"] as const),
    ]);
    expect(h.gets()).toBe(1);
    expect(results[0]).toBe("🍕");
    expect(results[4]).toEqual({ LOGTIME_EMOJI: "🍕", LOGTIME_SHOW_GOAL: true });
  });

  it("hands every reader its own copy, as a storage read did", async () => {
    const h = await boot({ initial: { FRIENDS_LIST: ["alice"], PROFILE_CARD_ORDER: ["LOGTIME"] } });
    const { getConfig, CONFIG_DEFAULT } = h.cfg;

    const first = await getConfig("FRIENDS_LIST");
    first.push("mallory");
    expect(await getConfig("FRIENDS_LIST")).toEqual(["alice"]);

    // normalizeConfigValue() completes PROFILE_CARD_ORDER in place: on a copy.
    const a = await getConfig("PROFILE_CARD_ORDER");
    const b = await getConfig("PROFILE_CARD_ORDER");
    expect(a).not.toBe(b);
    a.reverse();
    expect(b[0]).toBe("LOGTIME");
    expect(b).toHaveLength(CONFIG_DEFAULT.PROFILE_CARD_ORDER.length);

    // A write keeps the value as it was at set() time, as storage does.
    const written = ["bob"];
    await chrome.storage.local.set({ FRIENDS_LIST: written });
    written.push("eve");
    expect(await getConfig("FRIENDS_LIST")).toEqual(["bob"]);
    expect(h.gets()).toBe(1);
  });

  it("keeps the direct read for a key outside CONFIG_DEFAULT", async () => {
    const h = await boot({ initial: { DISCORD_EVAL_REGISTERED: true } });
    expect(await h.cfg.getConfig("DISCORD_EVAL_REGISTERED" as never)).toBe(true);
    expect(h.get).toHaveBeenLastCalledWith("DISCORD_EVAL_REGISTERED");
    expect(await h.cfg.getConfigMany(["LOGTIME_EMOJI", "DISCORD_EVAL_REGISTERED"] as never[])).toEqual({
      LOGTIME_EMOJI: "🌮",
      DISCORD_EVAL_REGISTERED: true,
    });
    expect(h.get).toHaveBeenLastCalledWith(["LOGTIME_EMOJI", "DISCORD_EVAL_REGISTERED"]);
  });
});

describe("settings snapshot: never stale", () => {
  it("shows a value written with chrome.storage.local.set at once, even if onChanged never fires", async () => {
    const h = await boot({ emitOnWrite: "never" });
    const { getConfig } = h.cfg;
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌮");

    await chrome.storage.local.set({ LOGTIME_EMOJI: "🍕" });
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕");

    // Fire-and-forget writes too (evaluations.ts, map-dialog.ts do this).
    void chrome.storage.local.set({ LOGTIME_GOAL_HOURS: 99 });
    expect(await getConfig("LOGTIME_GOAL_HOURS")).toBe(99);

    // No extra storage read, and storage itself got exactly the same call.
    expect(h.gets()).toBe(1);
    expect(h.set).toHaveBeenCalledWith({ LOGTIME_EMOJI: "🍕" });
    expect(h.store.get("LOGTIME_EMOJI")).toBe("🍕");
  });

  it("shows it at once when onChanged arrives after set() resolved, and stays right afterwards", async () => {
    const h = await boot({ emitOnWrite: "later" });
    const { getConfig } = h.cfg;
    await getConfig("LOGTIME_EMOJI");

    await chrome.storage.local.set({ LOGTIME_EMOJI: "🍕" });
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕"); // before the event
    await nextTask();
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕"); // after it

    // Our write, then the popup's right after it: events come in commit order
    // and the later one wins, as in storage.
    void chrome.storage.local.set({ LOGTIME_EMOJI: "🌯" });
    setTimeout(() => {
      h.store.set("LOGTIME_EMOJI", "🥙");
      h.emit({ LOGTIME_EMOJI: { oldValue: "🌯", newValue: "🥙" } });
    }, 0);
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌯"); // ours, no event yet
    await nextTask();
    await nextTask();
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🥙");
    expect(h.store.get("LOGTIME_EMOJI")).toBe("🥙");
    expect(h.gets()).toBe(1);
  });

  it("applies changes made by other contexts, and ignores the other storage areas", async () => {
    const h = await boot();
    const { getConfig } = h.cfg;
    await getConfig("LOGTIME_EMOJI");
    expect(h.addListener).toHaveBeenCalledTimes(1);

    h.emit({ LOGTIME_EMOJI: { newValue: "🌯" } });
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌯");

    h.emit({ LOGTIME_EMOJI: { newValue: "sync value" } }, "sync");
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌯");

    h.emit({ LOGTIME_EMOJI: { oldValue: "🌯" } }); // removed elsewhere
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌮");

    // Another listener mutating the event object cannot reach the snapshot.
    const list = ["alice"];
    h.emit({ FRIENDS_LIST: { newValue: list } });
    list.push("mallory");
    expect(await getConfig("FRIENDS_LIST")).toEqual(["alice"]);

    // Non-config keys are not kept.
    h.emit({ cluster_svg_1_2: { newValue: "x".repeat(1000) } });
    expect(h.gets()).toBe(1);
  });

  it("falls back to the default once a key is removed, or everything is cleared", async () => {
    const h = await boot({
      emitOnWrite: "never",
      initial: { LOGTIME_GOAL_HOURS: 200, LOGTIME_EMOJI: "🍕", CUSTOM_FONT: "serif" },
    });
    const { getConfig, CONFIG_DEFAULT } = h.cfg;
    expect(await getConfig("LOGTIME_GOAL_HOURS")).toBe(200);

    await chrome.storage.local.remove("LOGTIME_GOAL_HOURS");
    expect(await getConfig("LOGTIME_GOAL_HOURS")).toBe(CONFIG_DEFAULT.LOGTIME_GOAL_HOURS);

    await chrome.storage.local.remove(["LOGTIME_EMOJI"]);
    expect(await getConfig("LOGTIME_EMOJI")).toBe(CONFIG_DEFAULT.LOGTIME_EMOJI);
    expect(await getConfig("CUSTOM_FONT")).toBe("serif");

    await chrome.storage.local.clear();
    expect(await getConfig("CUSTOM_FONT")).toBe(CONFIG_DEFAULT.CUSTOM_FONT);
    expect(h.gets()).toBe(1);
  });

  it("lets writes and changes that land while the first read is in flight win over its answer", async () => {
    const h = await boot({
      emitOnWrite: "never",
      initial: { LOGTIME_EMOJI: "🍕", LOGTIME_GOAL_HOURS: 120 },
    });
    const { getConfig } = h.cfg;
    let answer!: (value: Record<string, unknown>) => void;
    h.get.mockImplementationOnce(() => new Promise((r) => (answer = r)));

    const first = getConfig("CUSTOM_FONT");
    void chrome.storage.local.set({ LOGTIME_GOAL_HOURS: 180 });
    void chrome.storage.local.remove("LOGTIME_EMOJI");
    h.emit({ CUSTOM_CSS: { newValue: "body{}" } });
    // Storage answers with what it held when the read was issued.
    answer({ LOGTIME_EMOJI: "🍕", LOGTIME_GOAL_HOURS: 120 });

    expect(await first).toBe("default");
    expect(await getConfig("LOGTIME_GOAL_HOURS")).toBe(180);
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌮");
    expect(await getConfig("CUSTOM_CSS")).toBe("body{}");
    expect(h.gets()).toBe(1);
  });

  it("discards an in-flight answer when storage is cleared meanwhile", async () => {
    const h = await boot({ emitOnWrite: "never", initial: { LOGTIME_EMOJI: "🍕" } });
    let answer!: (value: Record<string, unknown>) => void;
    h.get.mockImplementationOnce(() => new Promise((r) => (answer = r)));

    const first = h.cfg.getConfig("LOGTIME_EMOJI");
    void chrome.storage.local.clear();
    void chrome.storage.local.set({ CUSTOM_FONT: "mono" });
    answer({ LOGTIME_EMOJI: "🍕" });

    expect(await first).toBe("🌮");
    expect(await h.cfg.getConfig("CUSTOM_FONT")).toBe("mono");
  });

  it("does not replay changes seen during a failed read on top of the next one", async () => {
    const h = await boot({ emitOnWrite: "never" });
    let fail!: (error: Error) => void;
    h.get.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));

    const first = h.cfg.getConfig("LOGTIME_EMOJI");
    void chrome.storage.local.set({ LOGTIME_EMOJI: "🍕" }); // seen while in flight
    fail(new Error("Extension context invalidated."));
    expect(await first).toBe("🍕"); // the direct get

    await chrome.storage.local.set({ LOGTIME_EMOJI: "🌯" }); // nothing loaded or loading
    expect(await h.cfg.getConfig("LOGTIME_EMOJI")).toBe("🌯");
  });

  it("drops the snapshot when a write fails, so the next read asks storage", async () => {
    const h = await boot({ emitOnWrite: "never", initial: { LOGTIME_EMOJI: "🍕" } });
    const { getConfig } = h.cfg;
    await getConfig("LOGTIME_EMOJI");

    h.set.mockRejectedValueOnce(new Error("QUOTA_BYTES quota exceeded"));
    await expect(chrome.storage.local.set({ LOGTIME_EMOJI: "🌯" })).rejects.toThrow("QUOTA_BYTES");
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕");
    expect(h.gets()).toBe(2);

    h.set.mockImplementationOnce(() => {
      throw new TypeError("bad arguments");
    });
    expect(() => chrome.storage.local.set({ LOGTIME_EMOJI: "🥙" })).toThrow("bad arguments");
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕");
    expect(h.gets()).toBe(3);

    // A failed write of a cache key is none of the snapshot's business.
    h.set.mockRejectedValueOnce(new Error("QUOTA_BYTES quota exceeded"));
    await expect(chrome.storage.local.set({ cluster_svg_1_2: "x" })).rejects.toThrow();
    await getConfig("LOGTIME_EMOJI");
    expect(h.gets()).toBe(3);
  });

  it("leaves storage to interpret values that are not plain JSON, and callback-style writes", async () => {
    const h = await boot({ emitOnWrite: "never", initial: { LOGTIME_GOAL_HOURS: 150 } });
    const { getConfig, CONFIG_DEFAULT } = h.cfg;
    await getConfig("LOGTIME_GOAL_HOURS");

    // undefined: Chrome skips the key, Firefox stores it. Ask storage.
    await chrome.storage.local.set({ LOGTIME_GOAL_HOURS: undefined });
    expect(await getConfig("LOGTIME_GOAL_HOURS")).toBe(CONFIG_DEFAULT.LOGTIME_GOAL_HOURS);
    expect(h.gets()).toBe(2);

    await chrome.storage.local.set({ ACCOUNT: new Date(0) });
    await getConfig("ACCOUNT");
    expect(h.gets()).toBe(3);

    const done = vi.fn();
    (chrome.storage.local.set as (items: object, cb: () => void) => void)({ LOGTIME_EMOJI: "🍕" }, done);
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕");
    expect(h.gets()).toBe(4);
  });

  it("re-reads storage after resetConfigCache()", async () => {
    const h = await boot({ initial: { LOGTIME_EMOJI: "🍕" } });
    const { getConfig, resetConfigCache } = h.cfg;
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕");

    h.store.set("LOGTIME_EMOJI", "🌯"); // behind the module's back: no event, no wrapper
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕"); // it is a cache

    resetConfigCache();
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌯");
    expect(h.gets()).toBe(2);
  });

  it("discards a read that was in flight when resetConfigCache() ran", async () => {
    const h = await boot({ initial: { LOGTIME_EMOJI: "🍕" } });
    let answer!: (value: Record<string, unknown>) => void;
    h.get.mockImplementationOnce(() => new Promise((r) => (answer = r)));

    const first = h.cfg.getConfig("LOGTIME_EMOJI");
    h.store.set("LOGTIME_EMOJI", "🌯");
    h.cfg.resetConfigCache();
    answer({ LOGTIME_EMOJI: "🍕" });

    expect(await first).toBe("🌯");
    expect(h.gets()).toBe(2);
  });

  it("refills with one read in a fresh module instance (service worker restart)", async () => {
    const life1 = await boot();
    await life1.cfg.setConfig({ LOGTIME_GOAL_HOURS: 150, FRIENDS_LIST: ["alice"] });
    expect(life1.set).toHaveBeenCalledWith({ LOGTIME_GOAL_HOURS: 150, FRIENDS_LIST: ["alice"] });

    const life2 = await boot({ initial: Object.fromEntries(life1.store) });
    expect(await life2.cfg.getConfig("LOGTIME_GOAL_HOURS")).toBe(150);
    expect(await life2.cfg.getConfig("FRIENDS_LIST")).toEqual(["alice"]);
    expect(life2.gets()).toBe(1);
  });

  it("setConfig() writes through chrome.storage.local.set and is visible at once", async () => {
    const h = await boot({ emitOnWrite: "never" });
    await h.cfg.getConfig("LOGTIME_GOAL_HOURS");
    await h.cfg.setConfig({ LOGTIME_GOAL_HOURS: 150 });
    expect(h.set).toHaveBeenCalledWith({ LOGTIME_GOAL_HOURS: 150 });
    expect(await h.cfg.getConfig("LOGTIME_GOAL_HOURS")).toBe(150);
    expect(h.gets()).toBe(1);
  });
});

describe("settings snapshot: fallback to direct reads", () => {
  it("reads storage on every call when there is no onChanged (the shared test mock)", async () => {
    const h = await boot({ onChanged: false });
    const { getConfig, getConfigMany } = h.cfg;

    // Nothing wrapped: the storage methods are the ones the page provided.
    expect(chrome.storage.local.set).toBe(h.set);
    expect(chrome.storage.local.remove).toBe(h.remove);

    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌮");
    expect(await getConfig("LOGTIME_GOAL_HOURS")).toBe(140);
    expect(h.get.mock.calls).toEqual([["LOGTIME_EMOJI"], ["LOGTIME_GOAL_HOURS"]]);

    // The trap: a raw set() then a read. No snapshot, so nothing to go stale.
    await chrome.storage.local.set({ LOGTIME_EMOJI: "🍕" });
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🍕");
    await chrome.storage.local.remove("LOGTIME_EMOJI");
    expect(await getConfig("LOGTIME_EMOJI")).toBe("🌮");

    await getConfigMany(["LOGTIME_EMOJI", "CUSTOM_FONT"] as const);
    expect(h.get).toHaveBeenLastCalledWith(["LOGTIME_EMOJI", "CUSTOM_FONT"]);
    expect(h.gets()).toBe(5);
  });

  it("starts the direct read in the same tick as before", async () => {
    const h = await boot({ onChanged: false });
    void h.cfg.getConfig("LOGTIME_EMOJI");
    void h.cfg.getConfigMany(["CUSTOM_FONT"] as const);
    expect(h.gets()).toBe(2);
  });

  it("reads storage directly in an orphaned content script (no runtime.id)", async () => {
    const h = await boot({ runtimeId: null });
    await h.cfg.getConfig("LOGTIME_EMOJI");
    await h.cfg.getConfig("LOGTIME_EMOJI");
    expect(h.get.mock.calls).toEqual([["LOGTIME_EMOJI"], ["LOGTIME_EMOJI"]]);
  });

  it("keeps no snapshot if the storage methods cannot be wrapped", async () => {
    const h = await boot({ frozenArea: true });
    expect(chrome.storage.local.set).toBe(h.set);
    expect(h.addListener).not.toHaveBeenCalled();
    await chrome.storage.local.set({ LOGTIME_EMOJI: "🍕" });
    expect(await h.cfg.getConfig("LOGTIME_EMOJI")).toBe("🍕");
    await h.cfg.getConfig("LOGTIME_EMOJI");
    expect(h.gets()).toBe(2);
  });

  it("falls back to the direct read when the bulk read fails, and tries the snapshot again next time", async () => {
    const h = await boot({ initial: { LOGTIME_EMOJI: "🍕" } });
    h.get.mockRejectedValueOnce(new Error("Extension context invalidated."));
    expect(await h.cfg.getConfig("LOGTIME_EMOJI")).toBe("🍕");
    expect(h.get.mock.calls[1]).toEqual(["LOGTIME_EMOJI"]);

    await h.cfg.getConfig("CUSTOM_FONT");
    await h.cfg.getConfig("LOGTIME_GOAL_HOURS");
    expect(h.gets()).toBe(3); // the retry of the bulk read, then nothing
  });
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

type Read = ConfigKey | readonly ConfigKey[];

/**
 * The getConfig / getConfigMany calls of one load of your own profile page, in
 * start-up order, read off the call sites: main.ts (top level, then
 * runBetterIntra), profile.ts (initProfile and the modules it runs, visuals.ts
 * included), then logtime, clusters and shortcuts, the default active scripts.
 * Branches that only run on other pages or on user action are left out.
 */
const PROFILE_PAGE_STARTUP: Read[] = [
  // main.ts, top level
  "BETTER_INTRA_THEME", // theme-manager.ts initThemeManager
  "PROFILE_THEME_PRESET", // theme-manager.ts applyThemePreset
  [
    "CUSTOM_ACCENT_ENABLED", "CUSTOM_ACCENT_COLOR", "CUSTOM_ACCENT_GRADIENT", "CUSTOM_ACCENT_COLOR_2",
    "CUSTOM_FONT", "CUSTOM_FONT_FAMILY", "CUSTOM_FONT_SCALE", "CUSTOM_RADIUS", "CUSTOM_DENSITY",
    "CUSTOM_HIDE_FOOTER", "CUSTOM_CSS", "CUSTOM_THEME_ENABLED", "CUSTOM_THEME_BG", "CUSTOM_THEME_CARD",
    "CUSTOM_THEME_TEXT", "CUSTOM_PAGE_BG_URL", "CUSTOM_PAGE_BG_DIM", "CUSTOM_PAGE_BG_PRESET",
    "CUSTOM_BG_ANIMATE", "CUSTOM_CARD_OPACITY", "CUSTOM_CARD_STYLE", "CUSTOM_AVATAR_SHAPE",
    "CUSTOM_SCROLLBAR", "CUSTOM_CARD_BORDER_MODE", "CUSTOM_CARD_BORDER_COLOR", "CUSTOM_CARD_BORDER_WIDTH",
    "CUSTOM_CARD_GLOW", "CUSTOM_CARD_TITLE_MODE", "CUSTOM_CARD_TITLE_COLOR", "CUSTOM_CARDS",
  ], // customize.ts initCustomize (CUSTOMIZE_KEYS)
  ["CUSTOM_SHOW_OTHERS_LOOK"], // customize.ts
  ["PERF_DEFER_OFFSCREEN", "PERF_LAZY_IMAGES", "PERF_PAUSE_HIDDEN", "PERF_PRECONNECT"], // perf.ts initPerfStyles
  ["PERF_LAZY_IMAGES"], // perf.ts initPerfObservers
  ["EASTER_EGGS_ENABLED"], // eggs.ts initEasterEggs
  // main.ts, runBetterIntra
  "SUBJECT_TRACKER_ENABLED", // subjects/tracker.ts
  "ACTIVE_SCRIPTS", // hubSettings.storage.ts getActiveFeatures
  "CLUSTERS_CAMPUS", // hubSettings.ts
  "CLUSTERS_CAMPUS", // campus.ts ensureCampusData
  "PROFILE_IMAGE_URL", // visuals.ts updateNavAvatar
  // profile.ts initProfile
  "ACTIVE_SCRIPTS", // visuals.ts
  [
    "PROFILE_IMAGE_URL", "PROFILE_BANNER_URL", "PROFILE_BANNER_MODE", "PROFILE_BANNER_COLOR",
    "PROFILE_BACKGROUND_URL", "PROFILE_BACKGROUND_MODE", "PROFILE_BACKGROUND_COLOR", "PROFILE_AVATAR_BG",
    "PROFILE_DECORATION", "PROFILE_AVATAR_POSITION_X", "PROFILE_AVATAR_POSITION_Y", "PROFILE_AVATAR_SCALE",
    "PROFILE_BADGE_BG",
  ], // visuals.ts updateVisuals
  "CLUSTERS_CAMPUS", "PROFILE_THEME_PRESET", "PROFILE_USE_MODERN_INFO_CARD",
  "PROFILE_USE_CUSTOM_COLOR", "LOGTIME_CALENDAR_COLOR", // profile-card.ts
  "PROFILE_CARD_ORDER", // layout.ts
  "PROFILE_SHOW_MARKS", "PROFILE_PROJECTS_SORT", "PROFILE_MARKS_SHOW_REAL_DATE", // marks.ts
  "PROFILE_SHOW_ACHIEVEMENTS", // achievements.ts
  "CLUSTERS_CAMPUS", "PROFILE_BADGE_ORDER", "PROFILE_BADGE_WRAP", // badges.ts
  "PROFILE_SHOW_EVALUATIONS", // evaluations.ts
  "PROFILE_SHOW_ROULETTE", "PROFILE_SHOW_ROULETTE_HISTORY", "CLOUD_TOKEN", // roulette-stats.ts
  "PROFILE_PROJECTS_SORT", "PROFILE_THEME_PRESET", // projects-sort.ts
  "SHOW_FRIENDS_WIDGET", "CLUSTERS_CAMPUS", "CLOUD_TOKEN", "CLOUD_AUTH_FAILED", "PROFILE_THEME_PRESET",
  "FRIENDS_SORT_MODE", "FRIENDS_SORT_DIR", "FRIENDS_ONLINE_ONLY", "SHOW_CUSTOM_AVATARS_IN_FRIENDS", // friends.ui.ts
  // logtime.ts initLogtime
  [
    "LOGTIME_GOAL_HOURS", "LOGTIME_SHOW_AVERAGE", "LOGTIME_SHOW_GOAL", "LOGTIME_SHOW_TACOS",
    "LOGTIME_EMOJI", "LOGTIME_EMOJI_DIVISOR", "LOGTIME_EMOJI_RATE", "LOGTIME_SHOW_DAYS_MODE",
    "LOGTIME_CALENDAR_COLOR", "LOGTIME_LABELS_COLOR", "LOGTIME_RAINBOW_PALETTE", "DISABLE_ANIMATIONS",
    "LOGTIME_MAX_EARNINGS", "LOGTIME_CALENDAR_VIEW",
  ],
  "PROFILE_THEME_PRESET",
  ["CLOUD_LOGIN", "CLOUD_TOKEN"],
  // clusters.ts initClusters
  ["CLUSTERS_SHOW_MARKERS", "CLUSTERS_DEFAULT_ID", "CLUSTERS_OPEN_NEW_TAB"],
  // shortcuts.ts initShortcuts
  "ACTIVE_SCRIPTS", "SHORTCUTS_HIDE_IMPORTANT_LINKS", "SHORTCUTS_ALIGNMENT", "ADVANCED_OPEN_LINKS_NEW_TAB",
];

/** A user who changed a few things, some of them stored the legacy way. */
const REALISTIC_STORE = {
  ACTIVE_SCRIPTS: '["logtime","clusters","profile","shortcuts"]',
  CLUSTERS_CAMPUS: "1",
  CLOUD_TOKEN: "token",
  CLOUD_LOGIN: "student",
  PROFILE_THEME_PRESET: "ocean",
  PROFILE_CARD_ORDER: ["LOGTIME", "AGENDA"],
  PROFILE_IMAGE_URL: "https://example.com/me.png",
  LOGTIME_GOAL_HOURS: 120,
  CUSTOM_ACCENT_ENABLED: true,
  CUSTOM_ACCENT_COLOR: "#ff0066",
  FRIENDS_LIST: '["alice","bob"]',
  cluster_svg_1_2: "x".repeat(200_000),
  BADGES_DATA_paris: { badgeBaseUrl: "https://example.com", badges: {} },
};

async function replay(cfg: ConfigModule, reads: Read[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const read of reads) {
    out.push(typeof read === "string" ? await cfg.getConfig(read) : await cfg.getConfigMany(read));
  }
  return out;
}

describe("settings snapshot: measurement", () => {
  it("profile-page start-up: one storage read instead of one per call, same values", async () => {
    const before = await boot({ onChanged: false, initial: REALISTIC_STORE }); // the v1.10.0 path
    const valuesBefore = await replay(before.cfg, PROFILE_PAGE_STARTUP);

    const after = await boot({ initial: REALISTIC_STORE });
    const valuesAfter = await replay(after.cfg, PROFILE_PAGE_STARTUP);

    const calls = PROFILE_PAGE_STARTUP.length;
    const getConfigCalls = PROFILE_PAGE_STARTUP.filter((r) => typeof r === "string").length;
    console.info(
      `[config-cache] profile start-up: ${getConfigCalls} getConfig + ${calls - getConfigCalls} getConfigMany; ` +
        `storage.local.get calls ${before.gets()} -> ${after.gets()}`,
    );
    expect(valuesAfter).toEqual(valuesBefore);
    expect(before.gets()).toBe(calls);
    expect(calls).toBe(50);
    expect(after.gets()).toBe(1);
  });

  it("cloud-sync upload (account.ts): one read per synced key before, none once loaded", async () => {
    // One mock at a time: the module reads the global `chrome` at call time.
    const before = await boot({ onChanged: false, initial: REALISTIC_STORE });
    const keys = before.cfg.CLOUD_SYNC_KEYS;
    const valuesBefore = await replay(before.cfg, keys);

    const after = await boot({ initial: REALISTIC_STORE });
    await after.cfg.getConfig("CLOUD_TOKEN"); // the snapshot is warm by then
    const warm = after.gets();
    const valuesAfter = await replay(after.cfg, keys);

    console.info(
      `[config-cache] cloud-sync upload: storage.local.get calls ${before.gets()} -> ${after.gets() - warm}`,
    );
    expect(valuesAfter).toEqual(valuesBefore);
    expect(before.gets()).toBe(keys.length);
    expect(after.gets() - warm).toBe(0);
  });
});
