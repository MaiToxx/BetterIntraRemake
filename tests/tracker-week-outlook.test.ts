/**
 * The Phoenix/Pegasus popover said "Hours 21h30/40h" and left the rest to
 * the student: what is left, the daily pace, that the week closes on Friday
 * night (the calendar's weeks run Monday to Sunday) and that a day counts
 * for 12 h at most. weekOutlook() works it out, like goalTip() for months.
 */
import { describe, it, expect } from "vitest";

// A DST case below needs a zone that has one; the CI runner is in UTC.
process.env.TZ = "Europe/Paris";

import { weekOutlook, getCurrentWeekProgress } from "../src/features/logtime/tracker";

const gold = { days: 5, hours: 40, slots: null };
// Wednesday 23 September 2026, evening: the week began on Saturday the 19th.
const wednesday = new Date(2026, 8, 23, 19, 0);

describe("weekOutlook", () => {
  it("gives what is left, the pace and the days to go (today included)", () => {
    const stats = {
      "2026-09-19": "05:00:00",
      "2026-09-21": "08:00:00",
      "2026-09-22": "08:30:00",
    };
    expect(weekOutlook(stats, gold, wednesday)).toEqual({
      hoursLeft: 18.5,
      daysNeeded: 2,
      daysLeft: 3, // Wednesday, Thursday, Friday
      perDay: 370 / 60, // 18h30 over 3 days = 6h10
      met: false,
      reachable: true,
    });
  });

  it("rounds the pace up to the minute, so that it is enough", () => {
    // 10h01 left over 3 days: 200.33 min a day, so 3h21
    const stats = { "2026-09-19": "12:00:00", "2026-09-20": "12:00:00", "2026-09-21": "05:59:00" };
    const outlook = weekOutlook(stats, gold, wednesday)!;
    expect(outlook.hoursLeft * 60).toBeCloseTo(601);
    expect(outlook.perDay * 60).toBeCloseTo(201);
  });

  it("counts at most 12 h a day, like the badge", () => {
    const stats = { "2026-09-20": "14:00:00" };
    expect(getCurrentWeekProgress(stats, wednesday)!.hoursDone).toBe(12);
    expect(weekOutlook(stats, gold, wednesday)!.hoursLeft).toBe(28);
  });

  it("reads the Intra's fractional seconds", () => {
    const stats = { "2026-09-21": "02:30:00.500000" };
    expect(getCurrentWeekProgress(stats, wednesday)!.hoursDone).toBeCloseTo(2.5, 3);
  });

  it("the week runs Saturday to Friday", () => {
    const stats = { "2026-09-18": "10:00:00" }; // the Friday before: last week
    expect(weekOutlook(stats, gold, new Date(2026, 8, 19, 9))).toMatchObject({ daysLeft: 7, hoursLeft: 40 });
    expect(weekOutlook(stats, gold, new Date(2026, 8, 20, 9))!.daysLeft).toBe(6); // Sunday
    expect(weekOutlook(stats, gold, new Date(2026, 8, 25, 23, 59))!.daysLeft).toBe(1); // Friday
  });

  it("met is met", () => {
    const stats = {
      "2026-09-19": "08:00:00",
      "2026-09-20": "08:00:00",
      "2026-09-21": "08:00:00",
      "2026-09-22": "08:00:00",
      "2026-09-23": "08:00:00",
    };
    expect(weekOutlook(stats, gold, wednesday)).toMatchObject({ met: true, hoursLeft: 0, daysNeeded: 0 });
  });

  it("says when the hours can no longer fit in the 12 h a day left", () => {
    const friday = new Date(2026, 8, 25, 10);
    // 27h done, 13h left, and Friday alone can add 12h
    const stats = { "2026-09-19": "12:00:00", "2026-09-20": "12:00:00", "2026-09-21": "03:00:00" };
    expect(weekOutlook(stats, { days: 3, hours: 40, slots: null }, friday)!.reachable).toBe(false);
    // what today already did counts against today's 12h: 28h + 4h today, 8h left, room 8h
    const today = { ...stats, "2026-09-21": "04:00:00", "2026-09-25": "04:00:00" };
    expect(weekOutlook(today, { days: 3, hours: 40, slots: null }, friday)!.reachable).toBe(true);
  });

  it("says when the days can no longer be reached", () => {
    const friday = new Date(2026, 8, 25, 10);
    // three days done, today one of them: the two missing days cannot happen
    const stats = { "2026-09-19": "12:00:00", "2026-09-20": "12:00:00", "2026-09-25": "01:00:00" };
    expect(weekOutlook(stats, gold, friday)).toMatchObject({ daysNeeded: 2, reachable: false });
    // with nothing today yet, one missing day still fits
    const notToday = { "2026-09-19": "12:00:00", "2026-09-20": "12:00:00", "2026-09-21": "12:00:00", "2026-09-22": "01:00:00" };
    expect(weekOutlook(notToday, gold, friday)).toMatchObject({ daysNeeded: 1, reachable: true });
  });

  it("counts the days right across a DST change", () => {
    // Paris springs forward on Sunday 29 March 2026: that week is 143 h long
    const friday = new Date(2026, 3, 3, 12);
    expect(weekOutlook({ "2026-03-28": "01:00:00" }, gold, friday)!.daysLeft).toBe(1);
    // and falls back on Sunday 25 October 2026
    expect(weekOutlook({ "2026-10-24": "01:00:00" }, gold, new Date(2026, 9, 30, 12))!.daysLeft).toBe(1);
  });

  it("no data, no outlook", () => {
    expect(weekOutlook({}, gold, wednesday)).toBeNull();
  });
});
