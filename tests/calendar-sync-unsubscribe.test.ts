/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The calendar feed (.ics on the worker) must follow the Intra subscriptions:
 *  - unsubscribing from the LAST subscribed event used to upload nothing (the
 *    upload only ran for a non-empty list), so the worker kept serving the old
 *    event and its 15-minute reminder;
 *  - a failed events fetch looked like an empty list, so it must never be
 *    mistaken for "no subscriptions" and wipe the feed;
 *  - a subscribed event that moves or is renamed must re-sync;
 *  - the logtime widget and the feed share one events request per visit.
 *
 * A visit is what a page load of your own profile does: main.ts calls
 * maybeSyncCalendar() and the logtime widget draws the page's
 * locations_stats. One module instance for the whole file: the data listener
 * logtime.ts installs on `document` cannot be removed, so the steps run in
 * order, each one a page load later than the previous one.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { initLogtime } from "../src/features/logtime/logtime";
import {
  generateIcs,
  maybeSyncCalendar,
  syncCalendarIcs,
} from "../src/features/calendar/calendar-sync";
import { OWN_EVENTS_FRESH_MS } from "../src/features/calendar/own-events";

type EventsReply = "ok" | "500" | "network" | "error-body";

let subscribed = true;
let eventsReply: EventsReply = "ok";
const uploads: string[] = [];
const eventAuth: string[] = [];
let eventRequests = 0;

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
};

const talk = () => ({
  id: 1,
  name: "Talk",
  kind: "event",
  begin_at: "2026-09-25T10:00:00.000Z",
  end_at: "2026-09-25T11:00:00.000Z",
  location: "Room",
  is_subscribed: subscribed,
});

/** The page's locations_stats reaching the logtime widget. */
function sendStats() {
  document.dispatchEvent(
    new CustomEvent("42_LOGTIME_DATA", { detail: { "2026-09-20": "02:00:00" } }),
  );
}

/** One page load of your own profile: main.ts's feed sync and the widget. */
async function visit() {
  // a later page load: the previous visit's events are no longer fresh
  vi.setSystemTime(Date.now() + OWN_EVENTS_FRESH_MS + 1);
  const synced = maybeSyncCalendar();
  sendStats();
  await synced;
  await flush();
}

beforeAll(async () => {
  // Only Date: the memo of the events read is time-based, the waits are not.
  vi.useFakeTimers({ toFake: ["Date"] });
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  await chrome.storage.local.set({
    CLOUD_TOKEN: "sess",
    CLOUD_LOGIN: "alice",
    CALENDAR_SYNC_TOKEN: "abcdefgh1234",
  });
  sessionStorage.setItem("ft_intrapy_token", "Bearer x");
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/users/me/events")) {
      eventRequests++;
      eventAuth.push(String((init?.headers as Record<string, string>)?.Authorization));
      if (eventsReply === "network") throw new TypeError("Failed to fetch");
      if (eventsReply === "500") return new Response("oops", { status: 500 });
      if (eventsReply === "error-body") {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ "1": talk() }), { status: 200 });
    }
    if (u.includes("/calendar/update")) {
      const { ics } = JSON.parse(String(init?.body));
      uploads.push(ics.includes("SUMMARY:Talk") ? "with Talk" : "empty");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });

  const grid = document.createElement("div");
  const card = document.createElement("div");
  card.className = "bg-white md:h-96";
  card.textContent = "LOGTIME";
  grid.appendChild(card);
  document.body.appendChild(grid);

  await initLogtime();
});

describe("calendar sync follows the subscriptions", () => {
  it("uploads the subscribed event", async () => {
    await visit();
    expect(uploads).toEqual(["with Talk"]);
  });

  it("uploads an empty calendar once the last event is unsubscribed", async () => {
    subscribed = false;
    await visit();
    expect(uploads).toEqual(["with Talk", "empty"]);
  });

  it("does not upload the same empty calendar again", async () => {
    await visit();
    expect(uploads).toEqual(["with Talk", "empty"]);
  });

  it.each<EventsReply>(["500", "network", "error-body"])(
    "leaves the feed alone when the events fetch fails (%s)",
    async (reply) => {
      subscribed = true; // would upload if the failure were not detected
      eventsReply = reply;
      await visit();
      expect(uploads).toEqual(["with Talk", "empty"]);
      // the calendar is still drawn
      const root = document.getElementById("logtime-shadow-wrapper")!.shadowRoot!;
      expect(root.querySelectorAll(".day-cell").length).toBeGreaterThan(0);
      eventsReply = "ok";
      subscribed = false;
    },
  );

  it("uploads again when an event is subscribed again", async () => {
    subscribed = true;
    await visit();
    expect(uploads).toEqual(["with Talk", "empty", "with Talk"]);
  });

  it("an empty calendar is a valid feed the worker accepts", () => {
    const ics = generateIcs([]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("VEVENT");
    // the worker's /calendar/update refuses bodies under 50 characters
    expect(ics.length).toBeGreaterThanOrEqual(50);
  });
});

describe("calendar sync re-uploads a changed event", () => {
  const base = {
    id: 7,
    name: "Exam",
    kind: "exam",
    begin_at: "2026-10-01T08:00:00.000Z",
    end_at: "2026-10-01T11:00:00.000Z",
    location: "Cluster 1",
  };

  it.each([
    ["end time", { end_at: "2026-10-01T12:00:00.000Z" }],
    ["name", { name: "Exam rank 03" }],
    ["location", { location: "Cluster 2" }],
  ])("when its %s changes", async (_what, change) => {
    await syncCalendarIcs([base]);
    const before = uploads.length;
    await syncCalendarIcs([base]);
    expect(uploads.length).toBe(before); // unchanged: skipped
    await syncCalendarIcs([{ ...base, ...change }]);
    expect(uploads.length).toBe(before + 1);
  });
});

describe("one events request per visit", () => {
  it("is shared by the logtime markers and the feed, whichever starts first", async () => {
    subscribed = true;
    eventsReply = "ok";
    const before = uploads.length;

    eventRequests = 0;
    await visit(); // both at once
    expect(eventRequests).toBe(1);

    // the widget first, the feed once that read has landed
    vi.setSystemTime(Date.now() + OWN_EVENTS_FRESH_MS + 1);
    eventRequests = 0;
    sendStats();
    await flush();
    await maybeSyncCalendar();
    expect(eventRequests).toBe(1);

    // and the markers are drawn from that read
    const root = document.getElementById("logtime-shadow-wrapper")!.shadowRoot!;
    expect(root.querySelectorAll(".day-cell").length).toBeGreaterThan(0);
    // the first visit follows the previous describe's events; the second
    // one finds the feed already up to date
    expect(uploads.slice(before)).toEqual(["with Talk"]);
  });
});

/** A JWT whose exp is `expSec` (seconds since the epoch). */
function jwt(expSec: number): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `Bearer ${b64({ alg: "none" })}.${b64({ exp: expSec })}.sig`;
}

describe("the events fetch never sends an expired token", () => {
  it("waits for the page's fresh token instead of the expired cached one", async () => {
    const now = Math.floor(Date.now() / 1000);
    sessionStorage.setItem("ft_intrapy_token", jwt(now - 60));
    eventAuth.length = 0;
    const done = visit();
    // the page authenticates its next request: hook.js dispatches the token
    const fresh = jwt(now + 3600);
    await new Promise((r) => setTimeout(r, 5));
    document.dispatchEvent(new CustomEvent("42_INTRAPY_TOKEN", { detail: fresh }));
    await done;
    await flush();
    expect(eventAuth).toEqual([fresh]);
  });
});
