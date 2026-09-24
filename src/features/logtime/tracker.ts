import { getConfig } from "../../core/config.ts";
import { msg } from "../../core/i18n/i18n.ts";

export interface TrackerThresholds {
  days: number;
  hours: number;
  slots: number | null;
}

export interface TrackerState {
  mode: string;
  label: string;
  thresholds: TrackerThresholds;
}

export interface WeekProgress {
  daysDone: number;
  hoursDone: number;
  daysRequired: number;
  hoursRequired: number;
  slotsRequired: number | null;
}

/** Labels are msg(): shown with t() (tracker-card.ts). */
const THRESHOLDS: Record<string, TrackerState> = {
  "phoenix-1": {
    mode: "phoenix-1",
    label: msg("Phoenix - Phase 1"),
    thresholds: { days: 2, hours: 20, slots: null },
  },
  "phoenix-2": {
    mode: "phoenix-2",
    label: msg("Phoenix - Phase 2"),
    thresholds: { days: 3, hours: 25, slots: null },
  },
  "phoenix-3": {
    mode: "phoenix-3",
    label: msg("Phoenix - Phase 3"),
    thresholds: { days: 4, hours: 30, slots: null },
  },
  "phoenix-4": {
    mode: "phoenix-4",
    label: msg("Phoenix - Phase 4"),
    thresholds: { days: 5, hours: 35, slots: null },
  },
  "pegasus-bronze": {
    mode: "pegasus-bronze",
    label: msg("Pegasus - Bronze"),
    thresholds: { days: 4, hours: 30, slots: null },
  },
  "pegasus-silver": {
    mode: "pegasus-silver",
    label: msg("Pegasus - Silver"),
    thresholds: { days: 4, hours: 35, slots: null },
  },
  "pegasus-gold": {
    mode: "pegasus-gold",
    label: msg("Pegasus - Gold"),
    thresholds: { days: 5, hours: 40, slots: null },
  },
  "pegasus-diamond": {
    mode: "pegasus-diamond",
    label: msg("Pegasus - Diamond"),
    thresholds: { days: 5, hours: 45, slots: null },
  },
  "pegasus-vibranium": {
    mode: "pegasus-vibranium",
    label: msg("Pegasus - Vibranium"),
    thresholds: { days: 6, hours: 50, slots: null },
  },
};

/** A day counts for at most this many hours towards the week. */
export const PEGASUS_MAX_HOURS_PER_DAY = 12;

/** The phase `mode` (one of TRACKER_MODES), or null for "off" or an unknown id. */
export function trackerStateFor(mode: string): TrackerState | null {
  return Object.hasOwn(THRESHOLDS, mode) ? THRESHOLDS[mode] : null;
}

export async function getTrackerState(): Promise<TrackerState | null> {
  return trackerStateFor(await getConfig("TRACKER_MODE"));
}

export function getLogtimeWeekStart(date: Date = new Date()): Date {
  const day = date.getDay();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceSaturday = day === 0 ? 1 : (day - 6 + 7) % 7;
  start.setDate(start.getDate() - daysSinceSaturday);
  return start;
}

/** A "HH:MM:SS(.ffffff)" day total in hours (0 for a missing day). */
function dayHours(timeStr: string | undefined): number {
  const [h = 0, m = 0, s = 0] = (timeStr ?? "").split(":").map(Number);
  const hours = h + m / 60 + s / 3600;
  return Number.isFinite(hours) ? hours : 0;
}

export function getCurrentWeekProgress(
  stats: Record<string, string>,
  now: Date = new Date(),
): { daysDone: number; hoursDone: number } | null {
  const dates = Object.keys(stats).sort();
  if (dates.length === 0) return null;

  const weekStart = getLogtimeWeekStart(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  let daysDone = 0;
  let hoursDone = 0;

  for (const [dateStr, timeStr] of Object.entries(stats)) {
    // weekStart/weekEnd are local midnights: parse the day as local too,
    // otherwise one day of the week is dropped for every non-UTC user.
    const d = new Date(dateStr + "T00:00:00");
    if (d < weekStart || d > weekEnd) continue;

    const hours = dayHours(timeStr);
    if (hours > 0) daysDone++;
    hoursDone += Math.min(hours, PEGASUS_MAX_HOURS_PER_DAY);
  }

  return { daysDone, hoursDone };
}

export function computeWeekProgress(
  stats: Record<string, string>,
  state: TrackerState,
  now: Date = new Date(),
): WeekProgress | null {
  const progress = getCurrentWeekProgress(stats, now);
  if (!progress) return null;
  return {
    ...progress,
    daysRequired: state.thresholds.days,
    hoursRequired: state.thresholds.hours,
    slotsRequired: state.thresholds.slots,
  };
}

/** What is left of the tracked week (Saturday to Friday), for the badge's popover. */
export interface WeekOutlook {
  /** Hours still to do, rounded up to the minute; 0 once the hours are met. */
  hoursLeft: number;
  /** Days with logtime still to do; 0 once the days are met. */
  daysNeeded: number;
  /** Days until the week closes on Friday night, today included. */
  daysLeft: number;
  /** The hours a day that reach the hours goal, rounded up to the minute. */
  perDay: number;
  met: boolean;
  /** False once the goal cannot be met with what can still count this week. */
  reachable: boolean;
}

// Floating-point dust (40 - 21.5 hours is not always exactly 18.5) must not
// round 18h30 up to 18h31.
const EPSILON = 1e-6;
const ceilToMinute = (hours: number): number =>
  Math.max(0, Math.ceil(hours * 60 - EPSILON) / 60);

/**
 * The popover used to show done/required only: the student had to work out
 * what was left, that the week closes on Friday night (the calendar's weeks
 * run Monday to Sunday) and that a day counts for 12 h at most. Built like
 * goalTip() (utils.ts) for months: today counts as a day left, and the pace
 * is rounded up so that it is enough. `now` is injectable for tests.
 */
export function weekOutlook(
  stats: Record<string, string>,
  thresholds: TrackerThresholds,
  now: Date = new Date(),
): WeekOutlook | null {
  const progress = getCurrentWeekProgress(stats, now);
  if (!progress) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // round, not floor: two local midnights are 23 or 25 h apart across DST
  const elapsed = Math.round(
    (today.getTime() - getLogtimeWeekStart(now).getTime()) / 86_400_000,
  );
  const daysLeft = 7 - elapsed;
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todayHours = Math.min(dayHours(stats[key]), PEGASUS_MAX_HOURS_PER_DAY);

  const hoursLeft = ceilToMinute(thresholds.hours - progress.hoursDone);
  const daysNeeded = Math.max(0, thresholds.days - progress.daysDone);
  const perDay = ceilToMinute(hoursLeft / daysLeft);
  // What can still count: the rest of today's 12 h and all of the days after
  // it; a day with logtime today is already one of the days done.
  const hoursRoom =
    PEGASUS_MAX_HOURS_PER_DAY - todayHours + PEGASUS_MAX_HOURS_PER_DAY * (daysLeft - 1);
  const daysRoom = daysLeft - (todayHours > 0 ? 1 : 0);
  return {
    hoursLeft,
    daysNeeded,
    daysLeft,
    perDay,
    met: hoursLeft === 0 && daysNeeded === 0,
    reachable: hoursLeft <= hoursRoom + EPSILON && daysNeeded <= daysRoom,
  };
}

export function formatHours(hours: number): string {
  // round the total minutes first so 4h59m45s gives "5h", not "4h60"
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export async function saveTrackerMode(mode: string): Promise<void> {
  await chrome.storage.local.set({ TRACKER_MODE: mode });
}

export function findTrackerBadgeEl(): {
  type: "phoenix" | "pegasus";
  element: HTMLElement;
} | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    '[class*="text-primary-foreground"][class*="inline-flex"], .inline-flex.items-center.rounded.border, [class*="badge"]',
  );
  for (const el of candidates) {
    const text = (el.textContent?.trim() ?? "").toLowerCase();
    if (text === "phoenix") return { type: "phoenix", element: el };
    if (text === "pegasus") return { type: "pegasus", element: el };
  }
  return null;
}

export function thresholdsMet(
  progress: WeekProgress,
  state: TrackerState,
): boolean {
  return (
    progress.daysDone >= state.thresholds.days &&
    progress.hoursDone >= state.thresholds.hours
  );
}

export function detectTrackerBadges(): "phoenix" | "pegasus" | null {
  const found = findTrackerBadgeEl();
  return found ? found.type : null;
}

export const TRACKER_MODES = Object.keys(THRESHOLDS);
