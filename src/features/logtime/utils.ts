const rgbaCache = new Map<string, string>();

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
  if (left <= 0) return "Goal met";
  const [year, mon] = ym.split("-").map(Number);
  const card = year * 12 + (mon - 1);
  const current = now.getFullYear() * 12 + now.getMonth();
  if (card < current) return `Missed by ${fmtHours(left)}`;
  const lastDay = new Date(year, mon, 0).getDate();
  const daysLeft = card > current ? lastDay : lastDay - now.getDate() + 1;
  const perDay = fmtHours(Math.ceil(left / daysLeft / 60) * 60);
  return daysLeft === 1
    ? `${fmtHours(left)} left today`
    : `${fmtHours(left)} left · ${perDay}/day for ${daysLeft} days (today included)`;
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
      ? "today"
      : diffDays === 1
        ? "yesterday"
        : `${diffDays} days ago`;
  if (mode === "days") return relative;

  const [, m, d] = lastDateStr.split("-");
  return `${d}/${m} (${relative})`;
};
