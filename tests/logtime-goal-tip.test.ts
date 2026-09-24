/**
 * The goal tooltip of a month card: the current month used to say only
 * "Remaining: 32h", and a past month said "Remaining" too.
 */
import { describe, it, expect } from "vitest";
import { goalTip } from "../src/features/logtime/utils";

const H = 3600;
// 19 September 2026, local time: 12 days left in the month, today included.
const now = new Date(2026, 8, 19, 15, 0);

describe("goalTip", () => {
  it("gives what is left and the daily pace for the current month", () => {
    expect(goalTip("2026-09", 108 * H, 140 * H, now)).toBe("32h left · 2h40/day for 12 days (today included)");
  });

  it("rounds the pace up to the minute, so that it is enough", () => {
    // 10h over 12 days = 50 min a day exactly; 10h01 needs 50.08 → 51 min
    expect(goalTip("2026-09", 130 * H, 140 * H, now)).toContain("0h50/day");
    expect(goalTip("2026-09", 130 * H - 60, 140 * H, now)).toContain("0h51/day");
  });

  it("the last day of the month is 'left today'", () => {
    expect(goalTip("2026-09", 135 * H, 140 * H, new Date(2026, 8, 30, 9))).toBe("5h left today");
  });

  it("a past month is met or missed", () => {
    expect(goalTip("2026-08", 120 * H + 30 * 60, 140 * H, now)).toBe("Missed by 19h30");
    expect(goalTip("2025-12", 150 * H, 140 * H, now)).toBe("Goal met");
  });

  it("met is met, and no goal says nothing", () => {
    expect(goalTip("2026-09", 140 * H, 140 * H, now)).toBe("Goal met");
    expect(goalTip("2026-09", 10 * H, 0, now)).toBe("");
    expect(goalTip("2026-09", 10 * H, Number.NaN, now)).toBe("");
  });
});
