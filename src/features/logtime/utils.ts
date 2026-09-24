import { intlLocale, t, tp } from "../../core/i18n/i18n.ts";

const rgbaCache = new Map<string, string>();

/** French month and day names are lowercase: the calendar shows them as titles. */
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The month's name in the UI language ("September", "Septembre"). */
export function monthName(year: number, monthIndex: number): string {
  return capitalize(
    new Intl.DateTimeFormat(intlLocale("en-US"), { month: "long" }).format(
      new Date(year, monthIndex),
    ),
  );
}

/**
 * The days of the week, Monday first, in the UI language: "narrow" gives
 * M T W T F S S (L M M J V S D), "short" Mon Tue… (Lun. Mar.…).
 */
export function weekdayNames(style: "narrow" | "short"): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale("en-US"), { weekday: style });
  // 1 January 2024 was a Monday
  return Array.from({ length: 7 }, (_, i) =>
    capitalize(fmt.format(new Date(2024, 0, 1 + i))),
  );
}

export function limit(s: unknown): string {
  return Array.from(typeof s === "string" ? s : "🌮")
    .slice(0, 3)
    .join("");
}

export const fmtHours = (secs: number): string => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return m > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${h}h`;
};

/**
 * The goal line of a month card's tooltip. The current month says what is
 * left and the daily pace that reaches the goal (today counted, the pace
 * rounded up to the minute so that it is enough); a past month says met or
 * missed, where "Remaining" meant nothing. `now` is injectable for tests.
 */
export function goalTip(ym: string, total: number, goalSecs: number, now = new Date()): string {
  if (!(goalSecs > 0)) return "";
  const left = goalSecs - total;
  if (left <= 0) return t("Goal met");
  const [year, mon] = ym.split("-").map(Number);
  const card = year * 12 + (mon - 1);
  const current = now.getFullYear() * 12 + now.getMonth();
  if (card < current) return t("Missed by {h}", { h: fmtHours(left) });
  const lastDay = new Date(year, mon, 0).getDate();
  const daysLeft = card > current ? lastDay : lastDay - now.getDate() + 1;
  const perDay = fmtHours(Math.ceil(left / daysLeft / 60) * 60);
  return daysLeft === 1
    ? t("{left} left today", { left: fmtHours(left) })
    : t("{left} left · {perDay}/day for {n} days (today included)", {
        left: fmtHours(left),
        perDay,
        n: daysLeft,
      });
}

export function hexToRgba(hex: string, opacity: number): string {
  const key = `${hex}|${opacity}`;
  if (rgbaCache.has(key)) return rgbaCache.get(key)!;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const val = `rgba(${r}, ${g}, ${b}, ${opacity})`;
  rgbaCache.set(key, val);
  return val;
}

export function contrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? "#000000" : "#ffffff";
}

export function safeLabelsColor(color: string, theme: string): string {
  const isDark = theme === "dark" || theme === "dim";
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;

  if (isDark && luminance < 100) {
    const blend = 0.5;
    const nr = Math.round(r + (255 - r) * blend);
    const ng = Math.round(g + (255 - g) * blend);
    const nb = Math.round(b + (255 - b) * blend);
    return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
  }
  if (!isDark && luminance > 200) {
    const blend = 0.5;
    const nr = Math.round(r * (1 - blend));
    const ng = Math.round(g * (1 - blend));
    const nb = Math.round(b * (1 - blend));
    return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
  }
  return color;
}

export const getLastSeenFormatted = (
  stats: Record<string, string>,
  mode: "date" | "both" | "days" = "date",
): string => {
  const activeDays = Object.entries(stats)
    .filter(([, time]) => time !== "00:00:00")
    .map(([date]) => date)
    .sort();

  if (activeDays.length === 0) return "N/A";
  const lastDateStr = activeDays[activeDays.length - 1];
  if (mode === "date") {
    const [, m, d] = lastDateStr.split("-");
    return `${d}/${m}`;
  }

  // "YYYY-MM-DD" alone parses as UTC midnight, which is the previous local day
  // west of Greenwich ("today" would read as "yesterday"). Parse as local time.
  const lastDate = new Date(lastDateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  lastDate.setHours(0, 0, 0, 0);
  // round, not floor: two local midnights are 23 or 25 h apart across DST
  const diffDays = Math.round(
    (today.getTime() - lastDate.getTime()) / 86400000,
  );

  const relative =
    diffDays === 0
      ? t("today")
      : diffDays === 1
        ? t("yesterday")
        : tp(diffDays, "{n} day ago", "{n} days ago");
  if (mode === "days") return relative;

  const [, m, d] = lastDateStr.split("-");
  return `${d}/${m} (${relative})`;
};
