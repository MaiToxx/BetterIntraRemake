/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The private calendar feed used to be uploaded from the logtime widget's
 * data handler only. With the Logtime tab switched off (ACTIVE_SCRIPTS
 * without "logtime", so main.ts never starts the widget) the feed froze
 * without a word, while the Calendar tab promises a refresh on every visit to
 * your own profile. The widget is never started in this file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { maybeSyncCalendar } from "../src/features/calendar/calendar-sync";
import { OWN_EVENTS_FRESH_MS } from "../src/features/calendar/own-events";

const uploads: string[] = [];
let eventRequests = 0;
let clock = Date.now();

const talk = {
  id: 1,
  name: "Talk",
  kind: "event",
  begin_at: "2026-09-25T10:00:00.000Z",
  end_at: "2026-09-25T11:00:00.000Z",
  location: "Room",
  is_subscribed: true,
};

beforeEach(async () => {
  // Each case is a later page load: the memo of the events read is time-based.
  clock += OWN_EVENTS_FRESH_MS + 1;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  history.replaceState({}, "", "/");
  uploads.length = 0;
  eventRequests = 0;
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    ACTIVE_SCRIPTS: '["clusters","profile","shortcuts"]',
    CLOUD_TOKEN: "sess",
    CLOUD_LOGIN: "alice",
    CALENDAR_SYNC_TOKEN: "abcdefgh1234",
  });
  sessionStorage.setItem("ft_intrapy_token", "Bearer x");
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/users/me/events")) {
      eventRequests++;
      return new Response(JSON.stringify({ "1": talk }), { status: 200 });
    }
    if (u.includes("/calendar/update")) {
      const { ics } = JSON.parse(String(init?.body));
      uploads.push(ics.includes("SUMMARY:Talk") ? "with Talk" : "empty");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the calendar feed without the Logtime feature", () => {
  it("uploads the subscribed events on a visit to your own profile", async () => {
    // What the page itself does on load; nobody listens for it here.
    document.dispatchEvent(
      new CustomEvent("42_LOGTIME_DATA", { detail: { "2026-09-20": "02:00:00" } }),
    );
    await maybeSyncCalendar();
    expect(eventRequests).toBe(1);
    expect(uploads).toEqual(["with Talk"]);
  });

  it("makes no request at all without a calendar link", async () => {
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: "" });
    await maybeSyncCalendar();
    expect(eventRequests).toBe(0);
    expect(uploads).toEqual([]);
  });

  it("makes no request without a cloud session", async () => {
    await chrome.storage.local.remove(["CLOUD_TOKEN"]);
    await maybeSyncCalendar();
    expect(eventRequests).toBe(0);
  });

  it("does nothing on someone else's profile", async () => {
    history.replaceState({}, "", "/users/bob");
    await maybeSyncCalendar();
    expect(eventRequests).toBe(0);
    expect(uploads).toEqual([]);
  });

  it("is started by main.ts for every page, outside the feature switches", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf8");
    const call = src.indexOf("maybeSyncCalendar()");
    const loop = src.indexOf("for (const scriptId of activeScripts)");
    expect(call).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(-1);
    // before the loop over ACTIVE_SCRIPTS, not inside a feature's init
    expect(call).toBeLessThan(loop);
  });
});
