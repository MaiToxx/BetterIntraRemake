/**
 * The roulette countdown aimed at a fixed 06:00 UTC while the card said 8:00:
 * right in Paris summer time only.
 */
import { describe, it, expect } from "vitest";
import { nextRouletteTimestamp } from "../src/features/profile/cards/roulette-stats.ts";

const iso = (ts: number) => new Date(ts).toISOString();

describe("next roulette", () => {
  it("is Friday 08:00 Paris time in summer (06:00 UTC)", () => {
    // Wednesday 23 September 2026, noon UTC
    expect(iso(nextRouletteTimestamp(Date.UTC(2026, 8, 23, 12)))).toBe("2026-09-25T06:00:00.000Z");
  });

  it("is Friday 08:00 Paris time in winter (07:00 UTC)", () => {
    // Paris leaves summer time on Sunday 25 October 2026
    expect(iso(nextRouletteTimestamp(Date.UTC(2026, 9, 27, 12)))).toBe("2026-10-30T07:00:00.000Z");
    expect(iso(nextRouletteTimestamp(Date.UTC(2026, 11, 20)))).toBe("2026-12-25T07:00:00.000Z");
  });

  it("on Friday: today before 08:00, next week after", () => {
    expect(iso(nextRouletteTimestamp(Date.UTC(2026, 9, 30, 6, 59)))).toBe("2026-10-30T07:00:00.000Z");
    expect(iso(nextRouletteTimestamp(Date.UTC(2026, 9, 30, 7, 0)))).toBe("2026-11-06T07:00:00.000Z");
    expect(iso(nextRouletteTimestamp(Date.UTC(2026, 8, 25, 6, 0)))).toBe("2026-10-02T06:00:00.000Z");
  });
});
