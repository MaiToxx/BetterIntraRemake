/**
 * What the settings hub is made of: its tabs (FEATURE_DEFS), the shape of a
 * setting (HubSettingDef) and every setting of every tab (HUB_SETTING_DEFS).
 *
 * The settings of each tab live in settings/<tab>.ts and are only assembled
 * here, so a tab reads on its own. The imports go one way: a tab module takes
 * the types from this file with `import type` (erased at build time) and the
 * option lists several tabs share from settings/options.ts. A value imported
 * back from this file would be a cycle.
 */
import CLOCK from "../../assets/svg/clock.svg?raw";
import CALENDAR from "../../assets/svg/calendar.svg?raw";
import CLUSTERS from "../../assets/svg/clusters.svg?raw";
import USER from "../../assets/svg/user.svg?raw";
import SHORTCUT from "../../assets/svg/shortcut.svg?raw";
import ABOUT from "../../assets/svg/about.svg?raw";
import ADVANCED_SVG from "../../assets/svg/advanced.svg?raw";
import GRID_SVG from "../../assets/svg/grid.svg?raw";
import CUSTOMIZE_SVG from "../../assets/svg/sun.svg?raw";
import type { ConfigKey } from "../../core/config.ts";
import { LOGTIME_SETTINGS } from "./settings/logtime.ts";
import { CLUSTERS_SETTINGS } from "./settings/clusters.ts";
import { PROFILE_SETTINGS } from "./settings/profile.ts";
import { SHORTCUTS_SETTINGS } from "./settings/shortcuts.ts";
import { EXTRAS_SETTINGS } from "./settings/extras.ts";
import { CALENDAR_SETTINGS } from "./settings/calendar.ts";
import { ABOUT_SETTINGS } from "./settings/about.ts";
import { CUSTOMIZE_SETTINGS } from "./settings/customize.ts";
import { ADVANCED_SETTINGS } from "./settings/advanced.ts";

// Repository links come from package.json "repository" (see scripts/repo-info.js)
export const HUB_INFO = {
  name: "Better Intra",
  version: __APP_VERSION__,
  author: __REPO_URL__.replace(/\/[^/]+$/, ""),
  github: __REPO_URL__,
  issues: `${__REPO_URL__}/issues`,
  upstream: "https://github.com/nicopasla/better-intra",
  license: "MIT",
} as const;

export const FEATURE_DEFS = [
  {
    id: "profile",
    name: "Profile",
    icon: USER,
    desc: "Improves readability and allows local profile/background image customization.",
    cols: 2,
  },
  {
    id: "extras",
    name: "Extras",
    icon: GRID_SVG,
    desc: "Enable or disable optional add-ons. More can be added later.",
    cols: 3,
  },
  {
    id: "clusters",
    name: "Clusters",
    icon: CLUSTERS,
    desc: "Adds 'chair' direction markers and a default cluster picker with saved preference.",
    cols: 2,
  },
  {
    id: "logtime",
    name: "Logtime",
    icon: CLOCK,
    desc: "Redesign the logtime to show weekly and total hours.",
    cols: 3,
  },
  {
    id: "shortcuts",
    name: "Shortcuts",
    icon: SHORTCUT,
    desc: "Manage custom navigation links.",
    cols: 3,
  },
  {
    id: "calendar",
    name: "Calendar",
    icon: CALENDAR,
    desc: "Subscribe to your 42 events in Google Calendar, Apple Calendar, or any calendar app.",
  },
  {
    id: "customize",
    name: "Customize",
    icon: CUSTOMIZE_SVG,
    desc: "Accent colour, fonts, size, corners and your own CSS on every Intra page.",
    cols: 2,
  },
  {
    id: "advanced",
    name: "Advanced",
    icon: ADVANCED_SVG,
    desc: "General behavior settings.",
    cols: 2,
  },
  {
    id: "about",
    name: "About",
    icon: ABOUT,
    desc: "Information about Better Intra and its technical stack.",
  },
] as const;

export type FeatureId = (typeof FEATURE_DEFS)[number]["id"];
export const FEATURE_IDS = new Set<FeatureId>(FEATURE_DEFS.map((f) => f.id));

export const STORAGE_KEY = "ACTIVE_SCRIPTS";

export type SettingKind =
  | "toggle"
  | "number"
  | "text"
  | "textarea"
  | "custom-presets"
  | "custom-cards"
  | "url"
  | "select"
  | "color"
  | "radio-group"
  | "divider"
  | "shortcuts"
  | "emoji"
  | "about"
  | "card-order"
  | "action"
  | "calendar-panel"
  | "theme-preset"
  | "rainbow-palette"
  | "campus-info"
  | "feature-cards";

export { INTRA_FONT } from "../logtime/constants.ts";

export type FeatureCardOption = {
  label?: string;
  value?: string;
  color?: string;
  desc?: string;
  divider?: boolean;
  dependsOn?: ConfigKey;
  requiresCloud?: boolean;
  big?: boolean;
  subToggle?: {
    label: string;
    value: string;
    desc?: string;
    requiresCloud?: boolean;
    dependsOn?: ConfigKey;
  };
};

export type HubSettingDef = {
  feature: FeatureId;
  label: string;
  key?: ConfigKey;
  desc?: string;
  kind: SettingKind;
  nullable?: boolean;
  defaultValue?: unknown;
  options?: readonly FeatureCardOption[];
  grid?: boolean;
  colSpan?: number;
  fullWidth?: boolean;
  dependsOn?: ConfigKey;
  /**
   * Select parents only: the exact values of `dependsOn` that make this
   * setting useful. Without it every value but "", "none" and "default"
   * counts as on, which shows colour pickers for styles that ignore them.
   */
  dependsOnValues?: readonly string[];
  /** Public-profile link field: validated live with this link kind. */
  linkKind?: "github" | "gitlab" | "linkedin" | "website" | "discord";
  requiresCloud?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** "text" and "emoji": longest value the input accepts (UTF-16 units). */
  maxLength?: number;
  placeholder?: string;
  actionLabel?: string;
  actionType?: "export" | "import" | "reset" | "backup" | "reload-campus";
};

/** Every setting of every tab, in the order the tab draws them. */
export const HUB_SETTING_DEFS: Record<FeatureId, readonly HubSettingDef[]> = {
  logtime: LOGTIME_SETTINGS,
  clusters: CLUSTERS_SETTINGS,
  profile: PROFILE_SETTINGS,
  shortcuts: SHORTCUTS_SETTINGS,
  extras: EXTRAS_SETTINGS,
  calendar: CALENDAR_SETTINGS,
  about: ABOUT_SETTINGS,
  customize: CUSTOMIZE_SETTINGS,
  advanced: ADVANCED_SETTINGS,
};
