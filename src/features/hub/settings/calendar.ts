/**
 * Calendar tab of the settings hub: one panel, drawn by calendar.ui.ts.
 */
import type { HubSettingDef } from "../hubSettings.data.ts";

export const CALENDAR_SETTINGS: readonly HubSettingDef[] = [
  {
    feature: "calendar",
    label: "Calendar Sync",
    desc: "Subscribe to your 42 events in your calendar app.",
    kind: "calendar-panel",
    fullWidth: true,
  },
];
