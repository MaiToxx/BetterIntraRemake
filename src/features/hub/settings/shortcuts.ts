/**
 * Shortcuts tab of the settings hub: the link editor, and how the shortcuts
 * sit next to the Intra's important links.
 */
import { CONFIG_DEFAULT } from "../../../core/config.ts";
import type { HubSettingDef } from "../hubSettings.data.ts";

export const SHORTCUTS_SETTINGS: readonly HubSettingDef[] = [
  {
    feature: "shortcuts",
    key: "SHORTCUTS_LINKS",
    label: "",
    kind: "shortcuts",
    fullWidth: true,
  },
  {
    feature: "shortcuts",
    key: "SHORTCUTS_HIDE_IMPORTANT_LINKS",
    label: "Hide important links",
    desc: "Hides the default Intra important links on the profile to give shortcuts the full width.",
    kind: "toggle",
    defaultValue: CONFIG_DEFAULT.SHORTCUTS_HIDE_IMPORTANT_LINKS,
    grid: true,
    colSpan: 1,
  },
  {
    feature: "shortcuts",
    key: "SHORTCUTS_ALIGNMENT",
    label: "Shortcuts alignment",
    desc: "Aligns shortcuts left, center, or right when important links are hidden.",
    kind: "select",
    defaultValue: CONFIG_DEFAULT.SHORTCUTS_ALIGNMENT,
    options: [
      { label: "Left", value: "left" },
      { label: "Center", value: "center" },
      { label: "Right", value: "right" },
    ] as const,
    dependsOn: "SHORTCUTS_HIDE_IMPORTANT_LINKS",
    grid: true,
    colSpan: 2,
  },
];
