import { workerFetch } from "../../core/worker.ts";
import { fetchOwnEvents, isOwnProfilePage } from "./own-events.ts";

/** What an event of the feed is built from (a subset of the Intra event). */
interface IcsEvent {
  id: number;
  name: string;
  kind: string;
  begin_at: string;
  end_at: string;
  location?: string;
}

function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    // CRLF, lone CR and LF alike: a bare CR would end the content line
    .replace(/\r\n|\r|\n/g, "\\n");
}

function formatIcsDate(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * RFC 5545 §3.1: a content line is at most 75 octets; a longer one goes on
 * as lines that start with a space. Cut between code points, never inside a
 * character's UTF-8 bytes. Strict calendar apps dropped the long SUMMARY and
 * LOCATION lines (or the whole event) of an unfolded feed.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // 75 on the first line, 74 after the leading space of the others
    const room = parts.length === 0 ? 75 : 74;
    if (bytes + size > room) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// Covers every field the .ics is built from: with only id and begin_at, a
// subscribed event whose end, name or room changed was never re-uploaded.
// An empty list hashes to "0", so dropping the last event is uploaded once.
function computeHash(events: IcsEvent[]): string {
  let h = 0;
  for (const e of events) {
    const key = `${e.id}|${e.kind}|${e.begin_at}|${e.end_at}|${e.name}|${e.location ?? ""}`;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    }
  }
  return String(h);
}

/**
 * `now` is the DTSTAMP of every event (RFC 5545 requires one per VEVENT; the
 * feed had none). It is not part of computeHash(): an unchanged list is
 * still not uploaded again.
 */
export function generateIcs(events: IcsEvent[], now: Date = new Date()): string {
  const stamp = formatIcsDate(now.toISOString());
  const lines: string[] = [];
  lines.push(
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BetterIntra//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:42 Events",
  );

  for (const ev of events) {
    const url =
      ev.kind === "exam"
        ? `https://profile.intra.42.fr/exams/${ev.id}`
        : `https://profile.intra.42.fr/events/${ev.id}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.id}@better-intra`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatIcsDate(ev.begin_at)}`,
      `DTEND:${formatIcsDate(ev.end_at)}`,
      `SUMMARY:${escapeIcs(ev.name)}`,
      ev.location ? `LOCATION:${escapeIcs(ev.location)}` : "",
      `URL:${url}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      "DESCRIPTION:15 min before",
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).map(foldIcsLine).join("\r\n");
}

export async function syncCalendarIcs(
  events: IcsEvent[],
  force = false,
): Promise<void> {
  const store = await chrome.storage.local.get([
    "CLOUD_TOKEN",
    "CLOUD_LOGIN",
    "CALENDAR_SYNC_TOKEN",
    "CALENDAR_EVENTS_HASH",
  ]);
  const sessionToken = store["CLOUD_TOKEN"] as string;
  const cloudLogin = store["CLOUD_LOGIN"] as string;
  const calendarToken = store["CALENDAR_SYNC_TOKEN"] as string;

  if (!sessionToken || !cloudLogin || !calendarToken) return;

  const currentHash = computeHash(events);
  if (!force && store["CALENDAR_EVENTS_HASH"] === currentHash) return;

  const ics = generateIcs(events);

  // A 401 flags CLOUD_AUTH_FAILED through workerFetch: the worker keeps ten
  // sessions per login and revokes the oldest on the eleventh sign-in, and
  // this feed used to stop updating on the revoked machines without a word.
  const res = await workerFetch("/api/v1/private/calendar/update", {
    method: "POST",
    body: { ics },
    auth: { login: cloudLogin, token: sessionToken },
    timeoutMs: 20_000,
  });
  if (res.ok) {
    await chrome.storage.local.set({ CALENDAR_EVENTS_HASH: currentHash });
  } else if (res.status === 410) {
    // Every link of this login was stopped (Stop sharing, maybe in another
    // browser): the worker refuses the upload. Forget the dead link, or each
    // profile visit would try again and the Calendar tab would keep offering
    // a feed that no longer exists. Unless a new link was generated while
    // this upload was on its way: that one is live.
    const { CALENDAR_SYNC_TOKEN: current } = await chrome.storage.local.get("CALENDAR_SYNC_TOKEN");
    if (current === calendarToken) {
      await chrome.storage.local.remove(["CALENDAR_SYNC_TOKEN", "CALENDAR_EVENTS_HASH"]);
    }
  }
}

/**
 * Refresh the feed from your subscribed events. Called by main.ts on every
 * Intra page, whatever features are switched on: the Calendar tab promises a
 * refresh on each visit to your own profile, and the Logtime switch has no
 * say in that.
 *
 * Returns at once elsewhere than on your own profile, and before any request
 * unless a cloud session and a calendar link both exist, so students without
 * a link pay nothing. A failed events read leaves the feed alone; an empty
 * list is uploaded, so unsubscribing from the last event drops it.
 */
export async function maybeSyncCalendar(): Promise<void> {
  if (!isOwnProfilePage()) return;
  try {
    const store = await chrome.storage.local.get([
      "CLOUD_TOKEN",
      "CLOUD_LOGIN",
      "CALENDAR_SYNC_TOKEN",
    ]);
    if (!store.CLOUD_TOKEN || !store.CLOUD_LOGIN || !store.CALENDAR_SYNC_TOKEN) {
      return;
    }
    const events = await fetchOwnEvents();
    if (!events) return;
    await syncCalendarIcs(events.filter((e) => e.is_subscribed));
  } catch {
    // The feed keeps serving what it had; the next visit tries again.
  }
}
