/**
 * Your own Intra events (intrapy /users/me/events), read once for everything
 * on the page that needs them: the logtime day markers and the calendar feed.
 *
 * WHY a module of its own: the feed used to be uploaded from the logtime
 * widget's data handler, so turning the Logtime tab off froze a feed the
 * Calendar tab promises to refresh on every visit to your own profile. Both
 * now take the events from here, and one visit still makes one request.
 */
import { waitForIntrapyToken } from "../../core/intra/intrapy.ts";
import type { CalendarEvent } from "../logtime/types.ts";

const EVENTS_URL = "https://intrapy.intra.42.fr/api/v1/users/me/events";
/** How long the fetch waits for a fresh token when the cached one expired. */
const EVENTS_TOKEN_WAIT_MS = 10_000;
/**
 * How long a successful read serves later callers. The logtime handler and the
 * calendar sync start a few seconds apart on the same visit; a student who
 * subscribes to an event and comes back to the profile later gets a new read.
 */
export const OWN_EVENTS_FRESH_MS = 30_000;

let inFlight: Promise<CalendarEvent[] | null> | null = null;
let last: { at: number; events: CalendarEvent[] } | null = null;

export function isOwnProfilePage(): boolean {
  return (
    location.hostname === "profile-v3.intra.42.fr" && location.pathname === "/"
  );
}

/**
 * Your events, or null when they could not be read (no intrapy token, HTTP
 * error, network error, or a body that is not a list of events, such as
 * {"error": ...}). null is not "no events": the calendar sync must never take
 * a failed read for an empty list and wipe the feed.
 */
export function fetchOwnEvents(): Promise<CalendarEvent[] | null> {
  if (last && Date.now() - last.at < OWN_EVENTS_FRESH_MS) {
    return Promise.resolve(last.events);
  }
  if (inFlight) return inFlight;
  const request = readEvents();
  inFlight = request;
  void request.then((events) => {
    if (inFlight === request) inFlight = null;
    // A failure is not kept: the next caller tries again.
    if (events) last = { at: Date.now(), events };
  });
  return request;
}

async function readEvents(): Promise<CalendarEvent[] | null> {
  try {
    // Not the raw sessionStorage value: after a tab was left open it is an
    // expired JWT, and the 401 would read as "events unknown" for the visit.
    const token = await waitForIntrapyToken(EVENTS_TOKEN_WAIT_MS);
    if (!token) return null;
    const res = await fetch(EVENTS_URL, { headers: { Authorization: token } });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return null;
    const events = Object.values(data as Record<string, unknown>);
    // An event always has a begin_at the day markers can parse: a value
    // without one comes from an error body, not from a list of events.
    const valid = events.every(
      (e) =>
        !!e &&
        typeof e === "object" &&
        typeof (e as CalendarEvent).begin_at === "string",
    );
    return valid ? (events as CalendarEvent[]) : null;
  } catch {
    return null;
  }
}
