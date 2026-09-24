/**
 * The .ics feed against RFC 5545: every VEVENT carries a DTSTAMP, and no
 * content line is longer than 75 octets (longer ones are folded).
 */
import { describe, it, expect } from "vitest";
import { foldIcsLine, generateIcs } from "../src/features/calendar/calendar-sync.ts";

const bytes = (s: string) => new TextEncoder().encode(s).length;
const EVENT = {
  id: 7,
  name: "Conférence : " + "très longue présentation sur les systèmes distribués ".repeat(3) + "🎉",
  kind: "event",
  begin_at: "2026-10-01T14:00:00.000Z",
  end_at: "2026-10-01T16:00:00.000Z",
  location: "Amphithéâtre",
};

describe("the .ics feed", () => {
  it("stamps every event with the generation time", () => {
    const ics = generateIcs([EVENT, { ...EVENT, id: 8 }], new Date("2026-09-24T12:34:56.789Z"));
    expect(ics.match(/^DTSTAMP:20260924T123456Z$/gm)).toHaveLength(2);
  });

  it("folds long lines at 75 octets, and unfolding gives the text back", () => {
    const ics = generateIcs([EVENT]);
    for (const line of ics.split("\r\n")) expect(bytes(line)).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("SUMMARY:Conférence : très longue");
    expect(unfolded).toContain("🎉");
  });

  it("never cuts a character in two, and leaves short lines alone", () => {
    const folded = foldIcsLine("X:" + "é".repeat(80));
    for (const part of folded.split("\r\n")) expect(bytes(part)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("X:" + "é".repeat(80));
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });
});
