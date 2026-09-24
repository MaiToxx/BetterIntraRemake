/**
 * The types the logtime widget and its renderers share: the settings a render
 * reads, and the Intra calendar events shown on the day cells.
 *
 * WHY a module of its own: render.ts, compact.ts and heatmap.ts took these
 * from logtime.ts, the module that imports them, so each renderer and the
 * widget formed an import cycle (type-only, but a cycle a reader has to
 * untangle all the same). Nothing here exists at run time, so every edge
 * towards this file points one way.
 */
import type { BetterIntraConfig } from "../../core/config.ts";

/**
 * The widget's settings, read in one storage round-trip by logtime.ts and
 * overridden by a visited user's published settings. Mutable on purpose:
 * changing the view or visiting a profile updates it in place.
 */
export interface LogtimeConfig {
  goal_hours: BetterIntraConfig["LOGTIME_GOAL_HOURS"];
  show_average: BetterIntraConfig["LOGTIME_SHOW_AVERAGE"];
  show_goal: BetterIntraConfig["LOGTIME_SHOW_GOAL"];
  show_records: BetterIntraConfig["LOGTIME_SHOW_RECORDS"];
  show_tacos: BetterIntraConfig["LOGTIME_SHOW_TACOS"];
  /** LOGTIME_EMOJI, cut to three code points by limit() (utils.ts). */
  emoji: string;
  divisor: BetterIntraConfig["LOGTIME_EMOJI_DIVISOR"];
  rate: BetterIntraConfig["LOGTIME_EMOJI_RATE"];
  show_days_mode: BetterIntraConfig["LOGTIME_SHOW_DAYS_MODE"];
  calendar_color: BetterIntraConfig["LOGTIME_CALENDAR_COLOR"];
  labels_color: BetterIntraConfig["LOGTIME_LABELS_COLOR"];
  /** LOGTIME_RAINBOW_PALETTE resolved to its comma-separated gradient colours. */
  rainbow_colors: string;
  disable_animations: BetterIntraConfig["DISABLE_ANIMATIONS"];
  max_earnings: BetterIntraConfig["LOGTIME_MAX_EARNINGS"];
  calendar_view: BetterIntraConfig["LOGTIME_CALENDAR_VIEW"];
}

/** One event of the Intra calendar (intrapy /users/me/events). */
export interface CalendarEvent {
  id: number;
  name: string;
  kind: string;
  begin_at: string;
  end_at: string;
  location: string;
  is_subscribed: boolean;
}

/** Events keyed by local "YYYY-MM-DD". */
export type EventsByDate = Record<string, CalendarEvent[]>;
