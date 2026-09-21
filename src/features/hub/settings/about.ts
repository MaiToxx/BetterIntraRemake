/**
 * About tab of the settings hub: one panel, drawn by hub.about.ts.
 */
import type { HubSettingDef } from "../hubSettings.data.ts";

export const ABOUT_SETTINGS: readonly HubSettingDef[] = [
  {
    feature: "about",
    label: "",
    kind: "about",
    fullWidth: true,
  },
];
