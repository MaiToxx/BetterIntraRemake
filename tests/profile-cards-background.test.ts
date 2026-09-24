/**
 * @vitest-environment node
 *
 * The background's housekeeping: one GitHub request per six hours, sent
 * conditionally; an update alarm that survives a Firefox restart; a login
 * that reloads only the v3 profile tabs; the legacy stats cleanup off the
 * content-script path.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_META_KEY,
  UPDATE_KEY,
  isUpdateCheckFresh,
} from "../src/core/update-check";

type Fn = (...args: any[]) => unknown;
const listeners: Record<string, Fn> = {};
const event = (name: string) => ({
  addListener: vi.fn((fn: Fn) => {
    listeners[name] = fn;
  }),
});

const alarms = {
  create: vi.fn(),
  get: vi.fn(async (): Promise<unknown> => undefined),
  onAlarm: event("onAlarm"),
};
const action = { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() };
const tabs = {
  query: vi.fn(async (_q: unknown): Promise<{ id?: number }[]> => []),
  reload: vi.fn(),
};

const release = (tag: string, etag = 'W/"abc"') => ({
  ok: true,
  status: 200,
  headers: new Headers({ ETag: etag }),
  json: async () => ({
    tag_name: tag,
    html_url: `https://github.com/o/r/releases/tag/${tag}`,
    draft: false,
    assets: [{ name: "better-intra-firefox.xpi" }],
  }),
});
const notModified = () => ({ ok: false, status: 304, headers: new Headers(), json: async () => ({}) });

beforeAll(async () => {
  (globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      onInstalled: event("onInstalled"),
      onStartup: event("onStartup"),
      onMessage: event("onMessage"),
    },
    alarms,
    action,
    tabs,
    // an English browser, whatever the machine running the tests speaks (the
    // node environment's navigator.language is the OS locale)
    i18n: { getUILanguage: () => "en-US" },
    storage: { ...(globalThis as any).chrome.storage, onChanged: event("onChanged") },
  };
  await import("../src/background.ts");
});

beforeEach(async () => {
  await chrome.storage.local.clear();
  vi.clearAllMocks();
  alarms.get.mockResolvedValue(undefined);
  tabs.query.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("update check", () => {
  it("runs at start-up when nothing is stored, and records the ETag with the time", async () => {
    const fetchMock = vi.fn(async () => release("v2.0.0"));
    vi.stubGlobal("fetch", fetchMock);
    listeners.onStartup();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const store = await chrome.storage.local.get([UPDATE_KEY, UPDATE_CHECK_META_KEY]);
    expect(store[UPDATE_KEY]).toMatchObject({ version: "2.0.0" });
    expect(store[UPDATE_CHECK_META_KEY]).toMatchObject({ etag: 'W/"abc"' });
    expect(typeof store[UPDATE_CHECK_META_KEY].checkedAt).toBe("number");
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: "NEW" });
  });

  it("labels the badge in the language of the settings", async () => {
    await chrome.storage.local.set({ UI_LANGUAGE: "fr" });
    vi.stubGlobal("fetch", vi.fn(async () => release("v2.0.0")));
    listeners.onStartup();
    await flush();
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: "MAJ" });
  });

  it("relabels a badge already up when the language changes, and only then", async () => {
    await chrome.storage.local.set({ UI_LANGUAGE: "fr" });
    listeners.onChanged({ UI_LANGUAGE: { newValue: "fr" } });
    await flush();
    expect(action.setBadgeText).not.toHaveBeenCalled();

    const info = { version: "2.0.0", url: "https://github.com/o/r/releases/tag/v2.0.0", checkedAt: 1 };
    await chrome.storage.local.set({ [UPDATE_KEY]: info });
    listeners.onChanged({ UI_LANGUAGE: { newValue: "fr" } });
    await flush();
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "MAJ" });

    await chrome.storage.local.set({ UI_LANGUAGE: "en" });
    listeners.onChanged({ UI_LANGUAGE: { oldValue: "fr", newValue: "en" } });
    await flush();
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "NEW" });
  });

  it("makes no request when the last check is younger than six hours", async () => {
    await chrome.storage.local.set({
      [UPDATE_CHECK_META_KEY]: { checkedAt: Date.now() - UPDATE_CHECK_INTERVAL_MS / 2 },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    listeners.onStartup();
    listeners.onAlarm({ name: "better-intra-update-check" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks GitHub conditionally and keeps the stored update on 304", async () => {
    const info = { version: "2.0.0", url: "https://github.com/o/r/releases/tag/v2.0.0", checkedAt: 1 };
    await chrome.storage.local.set({
      [UPDATE_KEY]: info,
      [UPDATE_CHECK_META_KEY]: { checkedAt: Date.now() - UPDATE_CHECK_INTERVAL_MS - 1, etag: 'W/"abc"' },
    });
    const fetchMock = vi.fn(async () => notModified());
    vi.stubGlobal("fetch", fetchMock);
    listeners.onAlarm({ name: "better-intra-update-check" });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe('W/"abc"');
    const store = await chrome.storage.local.get([UPDATE_KEY, UPDATE_CHECK_META_KEY]);
    expect(store[UPDATE_KEY]).toEqual(info);
    expect(store[UPDATE_CHECK_META_KEY].etag).toBe('W/"abc"');
    expect(store[UPDATE_CHECK_META_KEY].checkedAt).toBeGreaterThan(Date.now() - 5000);
    expect(action.setBadgeText).not.toHaveBeenCalled();
  });

  it("leaves the stored state alone when GitHub refuses (rate limit)", async () => {
    const info = { version: "2.0.0", url: "https://github.com/o/r/releases/tag/v2.0.0", checkedAt: 1 };
    await chrome.storage.local.set({ [UPDATE_KEY]: info });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, headers: new Headers(), json: async () => ({}) })));
    listeners.onStartup();
    await flush();
    const store = await chrome.storage.local.get([UPDATE_KEY, UPDATE_CHECK_META_KEY]);
    expect(store[UPDATE_KEY]).toEqual(info);
    // not a completed check: the next wake may try again
    expect(store[UPDATE_CHECK_META_KEY]).toBeUndefined();
    expect(action.setBadgeText).not.toHaveBeenCalled();
  });

  it("isUpdateCheckFresh treats a clock set back as stale", () => {
    const now = 1_800_000_000_000;
    expect(isUpdateCheckFresh({ checkedAt: now - 1000 }, now)).toBe(true);
    expect(isUpdateCheckFresh({ checkedAt: now - UPDATE_CHECK_INTERVAL_MS }, now)).toBe(false);
    expect(isUpdateCheckFresh({ checkedAt: now + 60_000 }, now)).toBe(false);
    expect(isUpdateCheckFresh(undefined, now)).toBe(false);
  });

  it("nothing in the popup or the hub asks the background for a check", () => {
    // the popup used to send FT_CHECK_UPDATE on every open; the handler is gone
    // and no message re-creates it
    expect(listeners.onMessage({ type: "FT_CHECK_UPDATE" }, {}, () => {})).toBeUndefined();
  });
});

describe("update alarm", () => {
  it("is re-created at start-up when the browser dropped it", async () => {
    alarms.get.mockResolvedValue(undefined);
    listeners.onStartup();
    await flush();
    expect(alarms.get).toHaveBeenCalledWith("better-intra-update-check");
    expect(alarms.create).toHaveBeenCalledTimes(1);
    expect(alarms.create).toHaveBeenCalledWith("better-intra-update-check", {
      delayInMinutes: 1,
      periodInMinutes: 360,
    });
  });

  it("keeps an existing alarm's schedule", async () => {
    alarms.get.mockResolvedValue({ name: "better-intra-update-check" });
    listeners.onStartup();
    await flush();
    expect(alarms.create).not.toHaveBeenCalled();
  });

  it("is checked when the module itself loads", async () => {
    vi.resetModules();
    alarms.get.mockClear();
    await import("../src/background.ts");
    await flush();
    expect(alarms.get).toHaveBeenCalledWith("better-intra-update-check");
  });
});

describe("reload after login", () => {
  it("reloads the v3 profile tabs only, never a v2 page with a form", async () => {
    vi.useFakeTimers();
    tabs.query.mockResolvedValue([{ id: 7 }, { id: 9 }, {}]);
    listeners.onChanged({ CLOUD_TOKEN: { newValue: "t0k3n" } });
    await vi.advanceTimersByTimeAsync(500);
    expect(tabs.query).toHaveBeenCalledTimes(1);
    expect(tabs.query).toHaveBeenCalledWith({ url: "https://profile-v3.intra.42.fr/*" });
    expect(tabs.reload.mock.calls.map((c) => c[0])).toEqual([7, 9]);
  });

  it("does nothing when the token is removed", async () => {
    vi.useFakeTimers();
    listeners.onChanged({ CLOUD_TOKEN: { oldValue: "t0k3n" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(tabs.query).not.toHaveBeenCalled();
  });
});

describe("legacy profile stats keys", () => {
  it("are removed on update, once, in the background", async () => {
    await chrome.storage.local.set({
      FT_PROFILE_STATS_alice: { at: 1, data: {} },
      FT_PROFILE_STATS_CACHE: { bob: { at: 1, data: {} } },
      OTHER_KEY: "keep",
    });
    listeners.onInstalled({ reason: "update" });
    await flush();
    await flush();
    const store = await chrome.storage.local.get(null);
    expect(Object.keys(store).sort()).toEqual(["FT_PROFILE_STATS_CACHE", "OTHER_KEY"]);
  });

  it("are not looked for on a fresh install", async () => {
    vi.mocked(chrome.storage.local.get).mockClear();
    listeners.onInstalled({ reason: "install" });
    await flush();
    expect(vi.mocked(chrome.storage.local.get).mock.calls.map((c) => c[0])).not.toContain(null);
  });
});
