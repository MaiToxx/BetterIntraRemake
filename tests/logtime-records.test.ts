/**
 * Streaks and records in the logtime header: computed from the daily totals
 * already on the page, shown as one short badge (the streak) with the
 * records in its tooltip, so the widget keeps its height. Nothing showed
 * them: a student counted heatmap cells by hand.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "lit-html";

// A DST case below needs a zone that has one; the CI runner is in UTC.
process.env.TZ = "Europe/Paris";

import { computeRecords, recordsLines } from "../src/features/logtime/records";
import { renderHeaderContent } from "../src/features/logtime/render";
import { measureHeaderOverflow, measureRecordsRoom } from "../src/features/logtime/logtime";
import { setLang } from "../src/core/i18n/i18n";
import type { LogtimeConfig } from "../src/features/logtime/types";

// Wednesday 23 September 2026, afternoon
const now = new Date(2026, 8, 23, 15, 0);

afterEach(() => setLang("en"));

describe("computeRecords", () => {
  it("counts the streak up to today", () => {
    const stats = {
      "2026-09-20": "02:00:00",
      "2026-09-21": "03:00:00",
      "2026-09-22": "04:00:00",
      "2026-09-23": "01:00:00",
    };
    expect(computeRecords(stats, now)!.currentStreak).toBe(4);
  });

  it("keeps yesterday's streak while today is still empty, and ends it after a day off", () => {
    const stats = {
      "2026-09-21": "03:00:00",
      "2026-09-22": "04:00:00",
      "2026-09-23": "00:00:00", // today, nothing yet
    };
    expect(computeRecords(stats, now)!.currentStreak).toBe(2);
    // the day after tomorrow, the streak is over
    expect(computeRecords(stats, new Date(2026, 8, 25, 9))!.currentStreak).toBe(0);
  });

  it("finds the longest streak, the best day and the best Monday-to-Sunday week", () => {
    const stats = {
      "2026-09-01": "10:00:00", // Tue
      "2026-09-02": "11:20:00", // Wed: best day
      "2026-09-03": "10:00:00", // Thu
      "2026-09-05": "01:00:00", // Sat
      "2026-09-14": "08:00:00", // Mon, the next week but one
      "2026-09-15": "08:00:00",
      "2026-09-16": "08:00:00",
      "2026-09-17": "08:00:00",
      "2026-09-23": "02:00:00",
    };
    const r = computeRecords(stats, now)!;
    expect(r.longestStreak).toBe(4);
    expect(r.bestDay).toEqual({ date: "2026-09-02", secs: 11 * 3600 + 20 * 60 });
    // week of 31 Aug: 32h20; week of 14 Sep: 32h
    expect(r.bestWeek).toEqual({ monday: "2026-08-31", secs: 32 * 3600 + 20 * 60 });
    expect(r.currentStreak).toBe(1);
  });

  it("carries a streak across a DST change and a new year", () => {
    // Paris falls back on Sunday 25 October 2026
    const dst = { "2026-10-24": "01:00:00", "2026-10-25": "01:00:00", "2026-10-26": "01:00:00" };
    expect(computeRecords(dst, new Date(2026, 9, 26, 12))).toMatchObject({ currentStreak: 3, longestStreak: 3 });
    const newYear = { "2025-12-30": "01:00:00", "2025-12-31": "01:00:00", "2026-01-01": "01:00:00" };
    expect(computeRecords(newYear, new Date(2026, 0, 1, 12))).toMatchObject({ currentStreak: 3, longestStreak: 3 });
    // the week of 29 December 2025 spans both years
    expect(computeRecords(newYear, new Date(2026, 0, 1, 12))!.bestWeek.monday).toBe("2025-12-29");
  });

  it("reads the Intra's fractional seconds, and a zero with fractions is no activity", () => {
    const stats = { "2026-09-22": "00:00:00.000000", "2026-09-23": "01:30:15.750000" };
    const r = computeRecords(stats, now)!;
    expect(r.currentStreak).toBe(1);
    expect(r.bestDay.secs).toBeCloseTo(5415.75);
  });

  it("no day with logtime, no records", () => {
    expect(computeRecords({}, now)).toBeNull();
    expect(computeRecords({ "2026-09-23": "00:00:00" }, now)).toBeNull();
  });
});

describe("recordsLines", () => {
  const records = {
    currentStreak: 12,
    longestStreak: 1,
    bestDay: { date: "2026-03-12", secs: 11 * 3600 + 20 * 60 },
    bestWeek: { monday: "2026-03-09", secs: 52 * 3600 + 10 * 60 },
  };

  it("writes day/month dates, as the Active badge does", () => {
    expect(recordsLines(records)).toEqual([
      "Current streak: 12 days",
      "Longest streak: 1 day",
      "Best day: 11h20 (12/03)",
      "Best week: 52h10 (week of 09/03)",
      "Over the days shown",
    ]);
  });

  it("speaks French", () => {
    setLang("fr");
    expect(recordsLines(records)[0]).toBe("Série en cours : 12 jours");
    expect(recordsLines(records)[3]).toBe("Meilleure semaine : 52h10 (semaine du 09/03)");
  });
});

function makeConfig(): LogtimeConfig {
  return {
    show_tacos: false,
    emoji: "🌮",
    divisor: 1,
    rate: 1,
    max_earnings: 0,
    calendar_view: "normal",
  } as unknown as LogtimeConfig;
}

function header(records: ReturnType<typeof computeRecords>, collapsed = false, recordsHidden = false) {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  render(
    renderHeaderContent("23/09", {}, makeConfig(), "normal", vi.fn(), "#00bcba", "#fff", collapsed, records, recordsHidden),
    shadow,
  );
  return shadow;
}

describe("the records badge", () => {
  const records = computeRecords({ "2026-09-22": "04:00:00", "2026-09-23": "01:00:00" }, now);

  it("shows the streak, with the records in its tooltip and its accessible name", () => {
    const badge = header(records).querySelector<HTMLElement>(".lt-records-badge")!;
    expect(badge.textContent!.trim()).toBe("🔥 2");
    expect(badge.tabIndex).toBe(0);
    expect(badge.getAttribute("aria-label")).toContain("Current streak: 2 days. Longest streak: 2 days");
    expect(badge.dataset.tipHtml).toContain("Best day: 4h (22/09)<br/>");
  });

  it("a trophy when no streak is running", () => {
    const old = computeRecords({ "2026-09-01": "04:00:00" }, now);
    expect(header(old).querySelector(".lt-records-badge")!.textContent!.trim()).toBe("🏆");
  });

  it("sits before the Active badge, which keeps its place when there are no records", () => {
    const shadow = header(records);
    const active = shadow.querySelector(".lt-active-badge")!;
    expect(active.previousElementSibling!.classList.contains("lt-records-badge")).toBe(true);
    expect(active.classList.contains("ml-auto")).toBe(false);
    const none = header(null);
    expect(none.querySelector(".lt-records-badge")).toBeNull();
    expect(none.querySelector(".lt-active-badge")!.classList.contains("ml-auto")).toBe(true);
  });

  it("counts in the header overflow, so the view switcher folds before the line overflows", () => {
    const shadow = header(records);
    const lt = shadow.querySelector<HTMLElement>(".lt-header")!;
    Object.defineProperty(lt, "clientWidth", { value: 300, configurable: true });
    const width = (sel: string, w: number) =>
      vi.spyOn(shadow.querySelector(sel)!, "getBoundingClientRect").mockReturnValue({ width: w } as DOMRect);
    width(".lt-title", 60);
    width(".lt-view-join", 150);
    width(".lt-active-badge", 50);
    width(".lt-records-badge", 0);
    expect(measureHeaderOverflow(shadow)).toBe(false); // 260 + 24
    width(".lt-records-badge", 40);
    expect(measureHeaderOverflow(shadow)).toBe(true); // 300 + 30
  });

  // On a phone the folded line (dropdown instead of the view buttons) can be
  // full already: the badge used to stay in it and push the Active badge out
  // of the card.
  it("steps aside when even the folded header has no room for it", () => {
    const shadow = header(records, true);
    const lt = shadow.querySelector<HTMLElement>(".lt-header")!;
    Object.defineProperty(lt, "clientWidth", { value: 300, configurable: true });
    const width = (sel: string, w: number) =>
      vi.spyOn(shadow.querySelector(sel)!, "getBoundingClientRect").mockReturnValue({ width: w } as DOMRect);
    width(".lt-title", 60);
    width(".lt-view-join", 150); // folded: out of sight, not counted here
    width(".lt-view-dropdown", 50);
    width(".lt-active-badge", 100);
    width(".lt-records-badge", 40);
    expect(measureRecordsRoom(shadow)).toBe(true); // 250 + 30
    width(".lt-active-badge", 130);
    expect(measureRecordsRoom(shadow)).toBe(false); // 280 + 30
  });

  it("out of the line, it keeps its size to be measured, and the Active badge its place", () => {
    const shadow = header(records, true, true);
    const badge = shadow.querySelector<HTMLElement>(".lt-records-badge")!;
    expect(badge.classList.contains("lt-records-off")).toBe(true);
    expect(shadow.querySelector(".lt-active-badge")!.classList.contains("ml-auto")).toBe(true);
    expect(header(records, true, false).querySelector(".lt-records-off")).toBeNull();
  });
});
