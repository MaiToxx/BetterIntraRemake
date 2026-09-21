/**
 * Wiping the cloud data revokes every calendar link on the worker, so the
 * local link must go too: the panel used to keep showing a dead one. And an
 * event name with a lone carriage return must not end its .ics content line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wipeAllCloudData } from "../src/features/account/account";
import { generateIcs } from "../src/features/calendar/calendar-sync";

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    CLOUD_TOKEN: "sess",
    CLOUD_LOGIN: "alice",
    CALENDAR_SYNC_TOKEN: "old-link",
    CALENDAR_EVENTS_HASH: "abc",
    FRIENDS_LIST: ["bob"],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("wipe all cloud data", () => {
  it("forgets the calendar link the worker revoked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("All cloud data deleted")));
    expect(await wipeAllCloudData()).toBe(true);
    const left = await chrome.storage.local.get([
      "CLOUD_TOKEN",
      "CALENDAR_SYNC_TOKEN",
      "CALENDAR_EVENTS_HASH",
      "FRIENDS_LIST",
    ]);
    expect(left).toEqual({ FRIENDS_LIST: ["bob"] });
  });

  it("keeps the link when the worker refused the wipe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect(await wipeAllCloudData()).toBe(false);
    const left = await chrome.storage.local.get("CALENDAR_SYNC_TOKEN");
    expect(left.CALENDAR_SYNC_TOKEN).toBe("old-link");
  });
});

describe(".ics text escaping", () => {
  const ev = (name: string) => ({
    id: 1,
    name,
    kind: "event",
    begin_at: "2026-09-25T10:00:00.000Z",
    end_at: "2026-09-25T11:00:00.000Z",
    location: "Room",
  });

  it.each(["A\rB", "A\r\nB", "A\nB"])("folds any line break in a name into \\n (%j)", (name) => {
    const ics = generateIcs([ev(name) as never]);
    const summary = ics.split("\r\n").find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:A\\nB");
    expect(ics).not.toMatch(/\r(?!\n)/);
  });
});
