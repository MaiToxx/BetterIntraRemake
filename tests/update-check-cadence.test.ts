/**
 * @vitest-environment node
 *
 * The release check is documented as "every 6 hours", and the alarm fires
 * every 6 hours, but the freshness gate compared against the same 6 hours
 * while checkedAt is stamped once GitHub has answered. The next alarm then
 * found the check a few hundred ms short of 6 h old, skipped it, and the real
 * cadence was 12 h.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  UPDATE_CHECK_INTERVAL_MS,
  isUpdateCheckFresh,
} from "../src/core/update-check";

type Fn = (...args: any[]) => unknown;
const listeners: Record<string, Fn> = {};
const event = (name: string) => ({
  addListener: vi.fn((fn: Fn) => {
    listeners[name] = fn;
  }),
});

/** GitHub's answer, 350 ms after the request: the latency that made the gap. */
const LATENCY_MS = 350;
const fetchMock = vi.fn(
  () =>
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: true,
            status: 200,
            headers: new Headers({ ETag: 'W/"abc"' }),
            json: async () => ({
              tag_name: "v1.0.0",
              html_url: "https://github.com/o/r/releases/tag/v1.0.0",
              draft: false,
              assets: [{ name: "better-intra-firefox.xpi" }],
            }),
          }),
        LATENCY_MS,
      ),
    ),
);

beforeAll(async () => {
  (globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      onInstalled: event("onInstalled"),
      onStartup: event("onStartup"),
      onMessage: event("onMessage"),
    },
    alarms: { create: vi.fn(), get: vi.fn(async () => undefined), onAlarm: event("onAlarm") },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    tabs: { query: vi.fn(async () => []), reload: vi.fn() },
    storage: { ...(globalThis as any).chrome.storage, onChanged: event("onChanged") },
  };
  await import("../src/background.ts");
});

beforeEach(async () => {
  await chrome.storage.local.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One alarm, and GitHub's answer landing LATENCY_MS later. */
async function fireAlarm() {
  listeners.onAlarm({ name: "better-intra-update-check" });
  await vi.advanceTimersByTimeAsync(LATENCY_MS + 50);
}

describe("update check cadence", () => {
  it("asks GitHub on every 6-hour alarm, not on every other one", async () => {
    const t0 = new Date(2026, 8, 23, 8, 0).getTime();
    vi.setSystemTime(t0);
    await fireAlarm();
    for (let k = 1; k <= 3; k++) {
      vi.setSystemTime(t0 + k * UPDATE_CHECK_INTERVAL_MS);
      await fireAlarm();
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("still shares one request between the start-up check and the alarm a minute later", async () => {
    const t0 = new Date(2026, 8, 23, 8, 0).getTime();
    vi.setSystemTime(t0);
    listeners.onStartup();
    await vi.advanceTimersByTimeAsync(LATENCY_MS + 50);
    vi.setSystemTime(t0 + 60_000);
    await fireAlarm();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("counts a check stamped just after the previous alarm as due", () => {
    const alarm = 1_800_000_000_000;
    const stamped = alarm - UPDATE_CHECK_INTERVAL_MS + LATENCY_MS;
    expect(isUpdateCheckFresh({ checkedAt: stamped }, alarm)).toBe(false);
    expect(isUpdateCheckFresh({ checkedAt: alarm - 60_000 }, alarm)).toBe(true);
  });
});
