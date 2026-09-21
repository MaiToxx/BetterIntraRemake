/**
 * Manages all configuration for the Better Intra extension.
 * This file serves as the single source of truth for configuration keys,
 * their types, default values, and the logic for retrieving them from storage.
 */

/**
 * Defines the complete shape and types for all configuration options.
 * Using a strict interface ensures type safety across the application
 * and provides excellent autocompletion in the IDE.
 */
export interface BetterIntraConfig {
  // General Settings
  ACTIVE_SCRIPTS: string[];
  BETTER_INTRA_THEME: "dark" | "light" | "system";
  DISABLE_ANIMATIONS: boolean;

  // Cloud Sync Settings
  CLOUD_SYNC_ENABLED: boolean;
  LAST_CLOUD_SYNC: number | null;
  CLOUD_TOKEN: string;
  CLOUD_LOGIN: string;
  CLOUD_AUTH_FAILED: boolean;
  ACCOUNT: object | null; // Stores user account info from 42 API

  // Logtime Feature Settings
  LOGTIME_GOAL_HOURS: number;
  LOGTIME_SHOW_AVERAGE: boolean;
  LOGTIME_SHOW_GOAL: boolean;
  LOGTIME_SHOW_TACOS: boolean;
  LOGTIME_EMOJI: string;
  LOGTIME_EMOJI_DIVISOR: number;
  LOGTIME_EMOJI_RATE: number;
  LOGTIME_MAX_EARNINGS: number;
  LOGTIME_SHOW_DAYS_MODE: "date" | "days" | "both";
  LOGTIME_CALENDAR_COLOR: string;
  LOGTIME_LABELS_COLOR: string;
  LOGTIME_RAINBOW_PALETTE: string;
  LOGTIME_CALENDAR_VIEW: string;

  // Clusters Feature Settings
  CLUSTERS_SHOW_MARKERS: boolean;
  CLUSTERS_DEFAULT_ID: string;
  CLUSTERS_OPEN_NEW_TAB: boolean;

  // Profile Feature Settings
  PROFILE_EVENT_TYPE_FILTER: string;
  CLUSTERS_CAMPUS: string;
  PROFILE_IMAGE_URL: string;
  PROFILE_BANNER_URL: string;
  PROFILE_BANNER_MODE: "fill" | "fit";
  PROFILE_BANNER_COLOR: string;
  PROFILE_BACKGROUND_URL: string;
  PROFILE_BACKGROUND_MODE: "fill" | "fit";
  PROFILE_BACKGROUND_COLOR: string;
  PROFILE_CARD_ORDER: string[];
  PROFILE_USE_CUSTOM_COLOR: boolean;
  PROFILE_THEME_PRESET: string;
  PROFILE_SHOW_MARKS: boolean;
  PROFILE_SHOW_ROULETTE: boolean;
  PROFILE_SHOW_ROULETTE_HISTORY: boolean;
  PROFILE_MARKS_SORT_ORDER: "newest_first" | "oldest_first";
  PROFILE_PROJECTS_SORT: boolean;
  PROFILE_MARKS_SHOW_REAL_DATE: boolean;
  PROFILE_SHOW_ACHIEVEMENTS: boolean;
  PROFILE_SHOW_EVALUATIONS: boolean;
  PROFILE_USE_MODERN_INFO_CARD: boolean;
  PROFILE_AVATAR_BG: string;
  PROFILE_DECORATION: string;
  PROFILE_AVATAR_POSITION_X: number;
  PROFILE_AVATAR_POSITION_Y: number;
  PROFILE_AVATAR_SCALE: number;
  PROFILE_BADGE_BG: string;
  PROFILE_BADGE_ORDER: string[];
  PROFILE_BADGE_WRAP: boolean;
  PROFILE_IMAGE_HISTORY: string[];
  PROFILE_BANNER_HISTORY: string[];
  PROFILE_BACKGROUND_HISTORY: string[];

  // Shortcuts Feature Settings
  SHORTCUTS_LINKS: { name: string; url: string }[];
  SHORTCUTS_HIDE_IMPORTANT_LINKS: boolean;
  SHORTCUTS_ALIGNMENT: "left" | "center" | "right";

  FRIENDS_LIST: string[];
  FRIENDS_SORT_MODE: "name" | "level" | "wallet" | "correction";
  FRIENDS_SORT_DIR: "asc" | "desc";
  FRIENDS_ONLINE_ONLY: boolean;
  SHOW_FRIENDS_WIDGET: boolean;
  SHOW_CUSTOM_AVATARS_IN_FRIENDS: boolean;
  FRIENDS_DATA_CACHE: { data: unknown[]; timestamp: number } | null;
  TRACKER_MODE:
    | "off"
    | "phoenix-1"
    | "phoenix-2"
    | "phoenix-3"
    | "phoenix-4"
    | "pegasus-bronze"
    | "pegasus-silver"
    | "pegasus-gold"
    | "pegasus-diamond"
    | "pegasus-vibranium";

  DISCORD_ENABLED: boolean;
  DISCORD_ID: string;
  DISCORD_USERNAME: string;
  DISCORD_QUIET_ENABLED: boolean;
  DISCORD_QUIET_START: string;
  DISCORD_QUIET_END: string;

  // Calendar Sync
  CALENDAR_SYNC_TOKEN: string;
  CALENDAR_EVENTS_HASH: string;
  ADVANCED_OPEN_LINKS_NEW_TAB: boolean;
  /** Seven small secrets hidden in the Intra (see features/eggs). */
  EASTER_EGGS_ENABLED: boolean;
  EGGS_FOUND: string[];

  // Customize (look & feel of every Intra page)
  CUSTOM_ACCENT_ENABLED: boolean;
  CUSTOM_ACCENT_COLOR: string;
  CUSTOM_FONT: "default" | "system" | "humanist" | "rounded" | "serif" | "mono" | "custom";
  CUSTOM_FONT_FAMILY: string;
  CUSTOM_FONT_SCALE: number;
  CUSTOM_RADIUS: "default" | "none" | "small" | "large" | "full";
  CUSTOM_CSS: string;
  CUSTOM_THEME_ENABLED: boolean;
  CUSTOM_THEME_BG: string;
  CUSTOM_THEME_CARD: string;
  CUSTOM_THEME_TEXT: string;
  CUSTOM_PAGE_BG_URL: string;
  CUSTOM_PAGE_BG_DIM: number;
  CUSTOM_CARD_OPACITY: number;
  CUSTOM_AVATAR_SHAPE: "circle" | "rounded" | "square";
  CUSTOM_PAGE_BG_PRESET:
    | "none"
    | "aurora"
    | "sunset"
    | "ocean"
    | "forest"
    | "mono"
    | "midnight"
    | "candy"
    | "lava"
    | "nord"
    | "dracula"
    | "teal"
    | "space"
    | "mesh";
  CUSTOM_CARD_STYLE: "default" | "flat" | "soft" | "strong" | "outlined" | "glass" | "stripe";
  CUSTOM_SCROLLBAR: "default" | "thin" | "accent" | "hidden";
  CUSTOM_ACCENT_GRADIENT: boolean;
  CUSTOM_ACCENT_COLOR_2: string;
  CUSTOM_BG_ANIMATE: boolean;
  CUSTOM_DENSITY: "default" | "compact" | "comfortable";
  CUSTOM_HIDE_FOOTER: boolean;
  // Dashboard cards (Agenda, Evaluations, Achievements, Projects, Roulette, Logtime)
  CUSTOM_CARD_BORDER_MODE: "none" | "accent" | "custom";
  CUSTOM_CARD_BORDER_COLOR: string;
  CUSTOM_CARD_BORDER_WIDTH: number;
  CUSTOM_CARD_GLOW: boolean;
  CUSTOM_CARD_TITLE_MODE: "default" | "accent" | "custom";
  CUSTOM_CARD_TITLE_COLOR: string;
  /** Per-card overrides keyed by card id (see CARD_IDS in customize.ts). */
  CUSTOM_CARDS: Record<string, { bg?: string; border?: string; title?: string; glow?: boolean }>;
  CUSTOM_PRESETS: { name: string; values: Record<string, unknown> }[];
  /** Publish my look (accent, palette, background, cards) on my profile for other Better Intra users. */
  CUSTOM_SHARE_LOOK: boolean;
  /** Apply the look other users publish when I visit their profile. */
  CUSTOM_SHOW_OTHERS_LOOK: boolean;

  // Public profile extras (features/profile/extras): visible to every
  // Better Intra user who opens my profile.
  PROFILE_PUB_ENABLED: boolean;
  PROFILE_PUB_BIO: string;
  PROFILE_PUB_STATUS_EMOJI: string;
  PROFILE_PUB_STATUS_TEXT: string;
  PROFILE_PUB_PRONOUNS: string;
  /** Space-separated emoji shown next to the name. */
  PROFILE_PUB_FLAIR: string;
  PROFILE_PUB_GREETING: string;
  PROFILE_PUB_LINK_GITHUB: string;
  PROFILE_PUB_LINK_GITLAB: string;
  PROFILE_PUB_LINK_LINKEDIN: string;
  PROFILE_PUB_LINK_WEBSITE: string;
  PROFILE_PUB_LINK_DISCORD: string;
  PROFILE_PUB_NAME_STYLE: "default" | "accent" | "custom" | "gradient" | "rainbow" | "glow" | "neon";
  PROFILE_PUB_NAME_COLOR: string;
  PROFILE_PUB_NAME_COLOR_2: string;
  PROFILE_PUB_NAME_FONT: "default" | "system" | "humanist" | "rounded" | "serif" | "mono";
  PROFILE_PUB_FRAME: "none" | "solid" | "double" | "dashed" | "gradient" | "rainbow" | "glow" | "neon";
  PROFILE_PUB_FRAME_COLOR: string;
  PROFILE_PUB_FRAME_COLOR_2: string;
  PROFILE_PUB_LEVEL_STYLE: "default" | "custom" | "gradient" | "rainbow" | "striped";
  PROFILE_PUB_LEVEL_COLOR: string;
  PROFILE_PUB_LEVEL_COLOR_2: string;
  PROFILE_PUB_BANNER_GRADIENT: string;
  PROFILE_PUB_BANNER_DIM: number;
  PROFILE_PUB_BANNER_BLUR: number;
  PROFILE_PUB_CARD_GLOW: boolean;
  PROFILE_PUB_EFFECT: "none" | "snow" | "stars" | "fireflies" | "confetti" | "bubbles" | "sakura" | "rain" | "embers";
  PROFILE_PUB_EFFECT_INTENSITY: "low" | "medium" | "high";
  PROFILE_PUB_EFFECT_TINT: boolean;
  PROFILE_PUB_EFFECT_COLOR: string;
  /** Viewer side: show the extras other people publish on their profile. */
  PROFILE_SHOW_OTHERS_EXTRAS: boolean;

  // Lighten the Intra (features/performance): make the Intra's own pages
  // cheaper to render. All four default to on; see features/performance/perf.ts.
  /** content-visibility on the long repeated lists, so off-screen rows cost nothing. */
  PERF_DEFER_OFFSCREEN: boolean;
  /** loading="lazy" / decoding="async" on the page's own off-screen images. */
  PERF_LAZY_IMAGES: boolean;
  /** Pause the page's CSS animations and transitions while the tab is hidden. */
  PERF_PAUSE_HIDDEN: boolean;
  /** Warm the avatar CDN connection before the page asks for the first avatar. */
  PERF_PRECONNECT: boolean;

  // Subject Tracker
  SUBJECT_TRACKER_ENABLED: boolean;
  SUBJECT_TRACKER_SEND_DATA: boolean;
  SUBJECT_TRACKER_STATE: Record<
    string,
    {
      lastUrl?: string;
      versionDate?: number;
      changedAt?: number;
      checkedAt?: number;
    }
  >;
}

/**
 * Provides the default values for every configuration key.
 * This object is used as a fallback if a value is not found in chrome.storage.local.
 * It must implement the BetterIntraConfig interface to ensure all keys have a default.
 */
export const CONFIG_DEFAULT: BetterIntraConfig = {
  ACTIVE_SCRIPTS: ["logtime", "clusters", "profile", "shortcuts"],
  CLOUD_SYNC_ENABLED: false,
  LAST_CLOUD_SYNC: null,
  CLOUD_TOKEN: "",
  CLOUD_LOGIN: "",
  CLOUD_AUTH_FAILED: false,
  ACCOUNT: null,

  LOGTIME_GOAL_HOURS: 140,
  LOGTIME_SHOW_AVERAGE: true,
  LOGTIME_SHOW_GOAL: true,
  DISABLE_ANIMATIONS: false,
  LOGTIME_SHOW_TACOS: false,
  LOGTIME_EMOJI: "🌮",
  LOGTIME_EMOJI_DIVISOR: 8.7,
  LOGTIME_EMOJI_RATE: 2,
  LOGTIME_MAX_EARNINGS: 500,
  LOGTIME_SHOW_DAYS_MODE: "date",
  LOGTIME_CALENDAR_COLOR: "#00BCBA",
  LOGTIME_LABELS_COLOR: "#26a641",
  LOGTIME_RAINBOW_PALETTE: "rainbow",
  LOGTIME_CALENDAR_VIEW: "normal",

  CLUSTERS_SHOW_MARKERS: true,
  CLUSTERS_DEFAULT_ID: "",
  CLUSTERS_OPEN_NEW_TAB: false,

  PROFILE_EVENT_TYPE_FILTER: "all",
  CLUSTERS_CAMPUS: "",
  PROFILE_IMAGE_URL: "",
  PROFILE_BANNER_URL: "",
  PROFILE_BANNER_MODE: "fill",
  PROFILE_BANNER_COLOR: "",
  PROFILE_BACKGROUND_URL: "",
  PROFILE_BACKGROUND_MODE: "fill",
  PROFILE_BACKGROUND_COLOR: "",
  PROFILE_CARD_ORDER: [
    "AGENDA",
    "EVALUATIONS",
    "LOGTIME",
    "ACHIEVEMENTS",
    "PROJECTS",
    "THURSDAY ROULETTE",
  ],
  PROFILE_USE_CUSTOM_COLOR: true,
  PROFILE_THEME_PRESET: "dark",
  PROFILE_SHOW_MARKS: true,
  PROFILE_SHOW_ROULETTE: true,
  PROFILE_SHOW_ROULETTE_HISTORY: true,
  PROFILE_MARKS_SORT_ORDER: "newest_first",
  PROFILE_PROJECTS_SORT: true,
  PROFILE_MARKS_SHOW_REAL_DATE: false,
  PROFILE_SHOW_ACHIEVEMENTS: true,
  PROFILE_SHOW_EVALUATIONS: false,
  PROFILE_USE_MODERN_INFO_CARD: true,
  PROFILE_AVATAR_BG: "transparent",
  PROFILE_DECORATION: "none",
  PROFILE_AVATAR_POSITION_X: 50,
  PROFILE_AVATAR_POSITION_Y: 50,
  PROFILE_AVATAR_SCALE: 100,
  PROFILE_BADGE_BG: "",
  PROFILE_BADGE_ORDER: [],
  PROFILE_BADGE_WRAP: true,
  PROFILE_IMAGE_HISTORY: [],
  PROFILE_BANNER_HISTORY: [],
  PROFILE_BACKGROUND_HISTORY: [],

  BETTER_INTRA_THEME: "dark",
  SHORTCUTS_LINKS: [],
  SHORTCUTS_HIDE_IMPORTANT_LINKS: false,
  SHORTCUTS_ALIGNMENT: "left",

  FRIENDS_LIST: [],
  FRIENDS_SORT_MODE: "level",
  FRIENDS_SORT_DIR: "desc",
  FRIENDS_ONLINE_ONLY: false,
  SHOW_FRIENDS_WIDGET: true,
  SHOW_CUSTOM_AVATARS_IN_FRIENDS: true,
  FRIENDS_DATA_CACHE: null,
  TRACKER_MODE: "off",

  DISCORD_ENABLED: false,
  DISCORD_ID: "",
  DISCORD_USERNAME: "",
  DISCORD_QUIET_ENABLED: false,
  DISCORD_QUIET_START: "22:00",
  DISCORD_QUIET_END: "08:00",

  CALENDAR_SYNC_TOKEN: "",
  CALENDAR_EVENTS_HASH: "",
  ADVANCED_OPEN_LINKS_NEW_TAB: true,
  EASTER_EGGS_ENABLED: true,
  EGGS_FOUND: [],

  SUBJECT_TRACKER_STATE: {},
  SUBJECT_TRACKER_ENABLED: true,
  SUBJECT_TRACKER_SEND_DATA: true,

  PERF_DEFER_OFFSCREEN: true,
  PERF_LAZY_IMAGES: true,
  PERF_PAUSE_HIDDEN: true,
  PERF_PRECONNECT: true,

  CUSTOM_ACCENT_ENABLED: false,
  CUSTOM_ACCENT_COLOR: "#00babc",
  CUSTOM_FONT: "default",
  CUSTOM_FONT_FAMILY: "",
  CUSTOM_FONT_SCALE: 100,
  CUSTOM_RADIUS: "default",
  CUSTOM_CSS: "",
  CUSTOM_THEME_ENABLED: false,
  CUSTOM_THEME_BG: "#1c2130",
  CUSTOM_THEME_CARD: "#151a24",
  CUSTOM_THEME_TEXT: "#e2e8f0",
  CUSTOM_PAGE_BG_URL: "",
  CUSTOM_PAGE_BG_DIM: 40,
  CUSTOM_CARD_OPACITY: 100,
  CUSTOM_AVATAR_SHAPE: "circle",
  CUSTOM_PAGE_BG_PRESET: "none",
  CUSTOM_CARD_STYLE: "default",
  CUSTOM_SCROLLBAR: "default",
  CUSTOM_ACCENT_GRADIENT: false,
  CUSTOM_ACCENT_COLOR_2: "#7c3aed",
  CUSTOM_BG_ANIMATE: false,
  CUSTOM_DENSITY: "default",
  CUSTOM_HIDE_FOOTER: false,
  CUSTOM_CARD_BORDER_MODE: "none",
  CUSTOM_CARD_BORDER_COLOR: "#00babc",
  CUSTOM_CARD_BORDER_WIDTH: 2,
  CUSTOM_CARD_GLOW: false,
  CUSTOM_CARD_TITLE_MODE: "default",
  CUSTOM_CARD_TITLE_COLOR: "#00babc",
  CUSTOM_CARDS: {},
  CUSTOM_PRESETS: [],
  CUSTOM_SHARE_LOOK: false,
  CUSTOM_SHOW_OTHERS_LOOK: true,

  PROFILE_PUB_ENABLED: true,
  PROFILE_PUB_BIO: "",
  PROFILE_PUB_STATUS_EMOJI: "",
  PROFILE_PUB_STATUS_TEXT: "",
  PROFILE_PUB_PRONOUNS: "",
  PROFILE_PUB_FLAIR: "",
  PROFILE_PUB_GREETING: "",
  PROFILE_PUB_LINK_GITHUB: "",
  PROFILE_PUB_LINK_GITLAB: "",
  PROFILE_PUB_LINK_LINKEDIN: "",
  PROFILE_PUB_LINK_WEBSITE: "",
  PROFILE_PUB_LINK_DISCORD: "",
  PROFILE_PUB_NAME_STYLE: "default",
  PROFILE_PUB_NAME_COLOR: "#00babc",
  PROFILE_PUB_NAME_COLOR_2: "#7c3aed",
  PROFILE_PUB_NAME_FONT: "default",
  PROFILE_PUB_FRAME: "none",
  PROFILE_PUB_FRAME_COLOR: "#00babc",
  PROFILE_PUB_FRAME_COLOR_2: "#7c3aed",
  PROFILE_PUB_LEVEL_STYLE: "default",
  PROFILE_PUB_LEVEL_COLOR: "#00babc",
  PROFILE_PUB_LEVEL_COLOR_2: "#7c3aed",
  PROFILE_PUB_BANNER_GRADIENT: "none",
  PROFILE_PUB_BANNER_DIM: 0,
  PROFILE_PUB_BANNER_BLUR: 0,
  PROFILE_PUB_CARD_GLOW: false,
  PROFILE_PUB_EFFECT: "none",
  PROFILE_PUB_EFFECT_INTENSITY: "medium",
  PROFILE_PUB_EFFECT_TINT: false,
  PROFILE_PUB_EFFECT_COLOR: "#ffffff",
  PROFILE_SHOW_OTHERS_EXTRAS: true,
};

/**
 * A type representing all possible configuration keys, derived directly
 * from the BetterIntraConfig interface to prevent any mismatches.
 */
export type ConfigKey = keyof BetterIntraConfig;

export const CLOUD_SYNC_KEYS: ConfigKey[] = [
  "ACTIVE_SCRIPTS",
  "BETTER_INTRA_THEME",
  "DISABLE_ANIMATIONS",
  "LOGTIME_GOAL_HOURS",
  "LOGTIME_SHOW_AVERAGE",
  "LOGTIME_SHOW_GOAL",
  "LOGTIME_SHOW_TACOS",
  "LOGTIME_EMOJI",
  "LOGTIME_EMOJI_DIVISOR",
  "LOGTIME_EMOJI_RATE",
  "LOGTIME_MAX_EARNINGS",
  "LOGTIME_SHOW_DAYS_MODE",
  "LOGTIME_CALENDAR_COLOR",
  "LOGTIME_LABELS_COLOR",
  "LOGTIME_RAINBOW_PALETTE",
  "LOGTIME_CALENDAR_VIEW",
  "CLUSTERS_SHOW_MARKERS",
  "CLUSTERS_DEFAULT_ID",
  "CLUSTERS_OPEN_NEW_TAB",
  "PROFILE_EVENT_TYPE_FILTER",
  "CLUSTERS_CAMPUS",
  "PROFILE_IMAGE_URL",
  "PROFILE_BANNER_URL",
  "PROFILE_BANNER_MODE",
  "PROFILE_BANNER_COLOR",
  "PROFILE_BACKGROUND_URL",
  "PROFILE_BACKGROUND_MODE",
  "PROFILE_BACKGROUND_COLOR",
  "PROFILE_CARD_ORDER",
  "PROFILE_USE_CUSTOM_COLOR",
  "PROFILE_THEME_PRESET",
  "PROFILE_SHOW_MARKS",
  "PROFILE_SHOW_ROULETTE",
  "PROFILE_SHOW_ROULETTE_HISTORY",
  "PROFILE_MARKS_SORT_ORDER",
  "PROFILE_PROJECTS_SORT",
  "PROFILE_MARKS_SHOW_REAL_DATE",
  "PROFILE_SHOW_ACHIEVEMENTS",
  "PROFILE_SHOW_EVALUATIONS",
  "PROFILE_USE_MODERN_INFO_CARD",
  "PROFILE_AVATAR_BG",
  "PROFILE_DECORATION",
  "PROFILE_AVATAR_POSITION_X",
  "PROFILE_AVATAR_POSITION_Y",
  "PROFILE_AVATAR_SCALE",
  "PROFILE_BADGE_BG",
  "PROFILE_IMAGE_HISTORY",
  "PROFILE_BANNER_HISTORY",
  "PROFILE_BACKGROUND_HISTORY",
  "SHORTCUTS_LINKS",
  "SHORTCUTS_HIDE_IMPORTANT_LINKS",
  "SHORTCUTS_ALIGNMENT",
  "FRIENDS_LIST",
  "FRIENDS_SORT_MODE",
  "FRIENDS_SORT_DIR",
  "FRIENDS_ONLINE_ONLY",
  "SHOW_FRIENDS_WIDGET",
  "SHOW_CUSTOM_AVATARS_IN_FRIENDS",
  "DISCORD_ENABLED",
  "DISCORD_ID",
  "DISCORD_USERNAME",
  "DISCORD_QUIET_ENABLED",
  "DISCORD_QUIET_START",
  "DISCORD_QUIET_END",
  "CALENDAR_SYNC_TOKEN",
  "CALENDAR_EVENTS_HASH",
  "ADVANCED_OPEN_LINKS_NEW_TAB",
  "EASTER_EGGS_ENABLED",
  "PERF_DEFER_OFFSCREEN",
  "PERF_LAZY_IMAGES",
  "PERF_PAUSE_HIDDEN",
  "PERF_PRECONNECT",
  "CLOUD_SYNC_ENABLED",
  "TRACKER_MODE",
  "CUSTOM_ACCENT_ENABLED",
  "CUSTOM_ACCENT_COLOR",
  "CUSTOM_FONT",
  "CUSTOM_FONT_FAMILY",
  "CUSTOM_FONT_SCALE",
  "CUSTOM_RADIUS",
  "CUSTOM_CSS",
  "CUSTOM_THEME_ENABLED",
  "CUSTOM_THEME_BG",
  "CUSTOM_THEME_CARD",
  "CUSTOM_THEME_TEXT",
  "CUSTOM_PAGE_BG_URL",
  "CUSTOM_PAGE_BG_DIM",
  "CUSTOM_CARD_OPACITY",
  "CUSTOM_AVATAR_SHAPE",
  "CUSTOM_PAGE_BG_PRESET",
  "CUSTOM_CARD_STYLE",
  "CUSTOM_SCROLLBAR",
  "CUSTOM_ACCENT_GRADIENT",
  "CUSTOM_ACCENT_COLOR_2",
  "CUSTOM_BG_ANIMATE",
  "CUSTOM_DENSITY",
  "CUSTOM_HIDE_FOOTER",
  "CUSTOM_CARD_BORDER_MODE",
  "CUSTOM_CARD_BORDER_COLOR",
  "CUSTOM_CARD_BORDER_WIDTH",
  "CUSTOM_CARD_GLOW",
  "CUSTOM_CARD_TITLE_MODE",
  "CUSTOM_CARD_TITLE_COLOR",
  "CUSTOM_CARDS",
  "CUSTOM_PRESETS",
  "CUSTOM_SHARE_LOOK",
  "CUSTOM_SHOW_OTHERS_LOOK",
  "PROFILE_PUB_ENABLED",
  "PROFILE_PUB_BIO",
  "PROFILE_PUB_STATUS_EMOJI",
  "PROFILE_PUB_STATUS_TEXT",
  "PROFILE_PUB_PRONOUNS",
  "PROFILE_PUB_FLAIR",
  "PROFILE_PUB_GREETING",
  "PROFILE_PUB_LINK_GITHUB",
  "PROFILE_PUB_LINK_GITLAB",
  "PROFILE_PUB_LINK_LINKEDIN",
  "PROFILE_PUB_LINK_WEBSITE",
  "PROFILE_PUB_LINK_DISCORD",
  "PROFILE_PUB_NAME_STYLE",
  "PROFILE_PUB_NAME_COLOR",
  "PROFILE_PUB_NAME_COLOR_2",
  "PROFILE_PUB_NAME_FONT",
  "PROFILE_PUB_FRAME",
  "PROFILE_PUB_FRAME_COLOR",
  "PROFILE_PUB_FRAME_COLOR_2",
  "PROFILE_PUB_LEVEL_STYLE",
  "PROFILE_PUB_LEVEL_COLOR",
  "PROFILE_PUB_LEVEL_COLOR_2",
  "PROFILE_PUB_BANNER_GRADIENT",
  "PROFILE_PUB_BANNER_DIM",
  "PROFILE_PUB_BANNER_BLUR",
  "PROFILE_PUB_CARD_GLOW",
  "PROFILE_PUB_EFFECT",
  "PROFILE_PUB_EFFECT_INTENSITY",
  "PROFILE_PUB_EFFECT_TINT",
  "PROFILE_PUB_EFFECT_COLOR",
  "PROFILE_SHOW_OTHERS_EXTRAS",
];

export const VISUAL_CLOUD_KEYS: ConfigKey[] = [
  "PROFILE_IMAGE_URL",
  "PROFILE_BANNER_URL",
  "PROFILE_BANNER_MODE",
  "PROFILE_BANNER_COLOR",
  "PROFILE_BACKGROUND_URL",
  "PROFILE_BACKGROUND_MODE",
  "PROFILE_BACKGROUND_COLOR",
  "PROFILE_AVATAR_BG",
  "PROFILE_DECORATION",
  "PROFILE_AVATAR_POSITION_X",
  "PROFILE_AVATAR_POSITION_Y",
  "PROFILE_AVATAR_SCALE",
  "PROFILE_BADGE_BG",
  "PROFILE_IMAGE_HISTORY",
  "PROFILE_BANNER_HISTORY",
  "PROFILE_BACKGROUND_HISTORY",
];

// ---------------------------------------------------------------------------
// Settings snapshot: one storage round-trip per context instead of one per read
// ---------------------------------------------------------------------------
//
// WHY. Each getConfig() used to be one chrome.storage.local.get(), i.e. one IPC
// to the extension process. The profile page awaits dozens of them in a row
// before it is interactive, and the cloud-sync upload awaits one per synced key
// (~140). Now the first read in a context fetches every setting at once and the
// later reads are served from memory.
//
// WHAT IS FETCHED. The keys of CONFIG_DEFAULT, in one keyed get(), not
// get(null). The same storage area also holds caches that are none of
// getConfig()'s business and can be big (whole cluster SVGs, badge maps, the
// campus list): get(null) would copy all of them into every Intra tab on every
// page load and keep them in memory. A keyed get, like get(null), returns only
// the keys that were actually written, so every other key still falls back to
// CONFIG_DEFAULT in normalizeConfigValue(), JSON-string parsing and
// PROFILE_CARD_ORDER fix-up included. A key outside CONFIG_DEFAULT (the settings
// UI casts a few dynamic ones) is not in the snapshot and keeps the direct get.
//
// NEVER STALE. Three mechanisms keep the snapshot equal to storage.
//  1. chrome.storage.onChanged (area "local") applies every change and removal
//     made by any context: the popup, the service worker, another tab.
//  2. Writes made in THIS context are applied at the moment they are issued.
//     onChanged alone is not enough for them. About 76 call sites write with
//     `chrome.storage.local.set / remove / clear`, some read the key straight
//     back (profile.modal.ts stores the cloud visuals, then reads them with
//     getConfig(); hubSettings.storage.ts rewrites ACTIVE_SCRIPTS at start-up
//     and shortcuts.ts reads it a moment later), and no browser promises that
//     the onChanged event reaches the writer before its set() promise
//     resolves. A "recently written keys" list would need to see those writes
//     just the same, and the call sites must not change, so this module wraps
//     the three methods once (installWriteObserver). The wrapper records the
//     write, then calls the original with the same arguments and `this` and
//     hands back its result. setConfig() below is the typed way in for new code.
//  3. What cannot be mirrored exactly drops the whole snapshot, and the next
//     read fetches it again: a write that fails (rejected promise or
//     synchronous throw), a value that is not plain JSON data (Chrome and
//     Firefox store Dates, Maps, undefined or -Infinity differently, so only
//     storage itself knows what was kept), a callback-style call (its failure
//     only shows in runtime.lastError).
// Ordering is safe: onChanged events arrive in commit order and each one
// overwrites its key, so a write recorded early is corrected by any later write
// from anywhere. The listener is registered when this module is evaluated,
// before any feature registers its own (they all import this module), and
// listeners run in registration order: when customize.ts or theme-manager.ts
// re-read settings from their own onChanged handlers, the snapshot is already
// up to date.
//
// THREE CONTEXTS. The content script, the popup and the service worker each
// evaluate this module and so each get their own snapshot, listener and
// wrapper. That is fine: every context also receives the onChanged events of
// the others. A suspended service worker loses its globals; when it restarts,
// the module is evaluated again and the first read simply refills the snapshot.
// An orphaned content script (extension reloaded under an open tab, so
// chrome.runtime.id is gone) goes back to direct reads, which fail as before.
//
// FALLBACK. Without onChanged (the unit-test mock in tests/setup.ts has none),
// or if the storage methods cannot be wrapped, there is no snapshot at all and
// every read is the direct get it always was. A cache that nothing repairs
// would serve stale values, so it is off rather than half on.

/** Every key getConfig() knows; only these live in the snapshot. */
const SNAPSHOT_KEYS: readonly string[] = Object.keys(CONFIG_DEFAULT);
const SNAPSHOT_KEY_SET: ReadonlySet<string> = new Set(SNAPSHOT_KEYS);
/** Marks a removed key in `overlay`. */
const REMOVED = Symbol("removed");
/** jsonCopy() result for a value that is not plain JSON data. */
const NOT_JSON = Symbol("not-json");

/** The onChanged listener and the write wrapper are both in place. */
let cacheEnabled = false;
/** Raw stored values, exactly as get() returns them; null until loaded. */
let snapshot: Map<string, unknown> | null = null;
/** The one load in flight, shared by every concurrent reader. */
let loading: Promise<Map<string, unknown>> | null = null;
/** Changes seen while `loading` was in flight, applied on top of its result. */
let overlay = new Map<string, unknown>();
/** A clear() happened while `loading` was in flight: drop its result. */
let overlayCleared = false;
/** Bumped by resetConfigCache(), so a load started before it is discarded. */
let generation = 0;

function cacheUsable(): boolean {
  return cacheEnabled && typeof chrome.runtime?.id === "string";
}

/**
 * A fresh copy, as every get() returned one: callers may mutate what they get.
 * Stored settings are plain JSON data, copied here in this script's own realm;
 * structuredClone() only for anything else (in a Firefox content script it can
 * resolve to the page window's, which would hand back the page's objects).
 */
function copyRaw(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const copy = jsonCopy(value);
  return copy === NOT_JSON ? structuredClone(value) : copy;
}

/**
 * Deep copy of `value` if it is plain JSON data (what both browsers store and
 * give back unchanged), NOT_JSON otherwise.
 */
function jsonCopy(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : NOT_JSON;
  if (typeof value !== "object" || depth > 64) return NOT_JSON;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return NOT_JSON;
      const item = jsonCopy(value[i], depth + 1);
      if (item === NOT_JSON) return NOT_JSON;
      out.push(item);
    }
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return NOT_JSON;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key === "__proto__") return NOT_JSON;
    const item = jsonCopy((value as Record<string, unknown>)[key], depth + 1);
    if (item === NOT_JSON) return NOT_JSON;
    out[key] = item;
  }
  return out;
}

/** Record one key's new raw value (or REMOVED), whatever the load state. */
function applyChange(key: string, value: unknown): void {
  if (!SNAPSHOT_KEY_SET.has(key)) return;
  if (snapshot) {
    if (value === REMOVED) snapshot.delete(key);
    else snapshot.set(key, value);
  } else if (loading) {
    overlay.set(key, value);
  }
  // Neither loaded nor loading: the next load will read storage after this.
}

function applyClear(): void {
  if (snapshot) {
    snapshot.clear();
  } else if (loading) {
    overlay.clear();
    overlayCleared = true;
  }
}

function loadSnapshot(): Promise<Map<string, unknown>> {
  if (snapshot) return Promise.resolve(snapshot);
  if (loading) return loading;
  const gen = generation;
  // Left over from a load that failed: this get is issued after those changes
  // and will contain them, or newer values the overlay must not undo.
  overlay = new Map();
  overlayCleared = false;
  const pending = chrome.storage.local.get([...SNAPSHOT_KEYS]).then(
    (res): Map<string, unknown> | Promise<Map<string, unknown>> => {
      // resetConfigCache() ran meanwhile: this answer may predate what caused it.
      if (gen !== generation) return loadSnapshot();
      const map = new Map<string, unknown>();
      if (res && !overlayCleared) {
        for (const key of SNAPSHOT_KEYS) {
          const value = (res as Record<string, unknown>)[key];
          if (value !== undefined) map.set(key, value);
        }
      }
      for (const [key, value] of overlay) {
        if (value === REMOVED) map.delete(key);
        else map.set(key, value);
      }
      overlay = new Map();
      overlayCleared = false;
      snapshot = map;
      loading = null;
      return map;
    },
    (error: unknown) => {
      if (gen === generation) loading = null;
      throw error;
    },
  );
  loading = pending;
  return pending;
}

/**
 * The snapshot if it can serve these keys, null for the direct get. Returned
 * synchronously whenever possible: without a snapshot the direct get starts in
 * the same tick as it always did, and a loaded snapshot costs no extra await.
 */
function snapshotFor(
  keys: readonly string[],
): Map<string, unknown> | null | Promise<Map<string, unknown> | null> {
  if (!cacheUsable() || !keys.every((k) => SNAPSHOT_KEY_SET.has(k))) return null;
  // A failed bulk read falls back to the per-call get, which fails or not as before.
  return snapshot ?? loadSnapshot().catch(() => null);
}

/**
 * Drop the snapshot: the next read fetches every setting again. For tests, and
 * for code that rewrites storage behind this module's back.
 */
export function resetConfigCache(): void {
  generation++;
  snapshot = null;
  loading = null;
  overlay = new Map();
  overlayCleared = false;
}

// -- this context's own writes (see "NEVER STALE", point 2) -----------------

/** @returns whether the write concerns the snapshot, i.e. a failure must drop it. */
function recordSet(items: unknown, hasCallback: boolean): boolean {
  if (!cacheEnabled || items === null || typeof items !== "object") return false;
  const copies: [string, unknown][] = [];
  for (const key of Object.keys(items)) {
    if (!SNAPSHOT_KEY_SET.has(key)) continue;
    const copy = hasCallback
      ? NOT_JSON
      : jsonCopy((items as Record<string, unknown>)[key]);
    if (copy === NOT_JSON) {
      resetConfigCache();
      return true;
    }
    copies.push([key, copy]);
  }
  for (const [key, copy] of copies) applyChange(key, copy);
  return copies.length > 0;
}

function recordRemove(keys: unknown, hasCallback: boolean): boolean {
  if (!cacheEnabled) return false;
  const list =
    typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : [];
  const ours = list.filter(
    (k): k is string => typeof k === "string" && SNAPSHOT_KEY_SET.has(k),
  );
  if (ours.length === 0) return false;
  if (hasCallback) resetConfigCache();
  else for (const key of ours) applyChange(key, REMOVED);
  return true;
}

function recordClear(hasCallback: boolean): boolean {
  if (!cacheEnabled) return false;
  if (hasCallback) resetConfigCache();
  else applyClear();
  return true;
}

type WriteMethod = "set" | "remove" | "clear";
type AnyFn = (...args: unknown[]) => unknown;

/**
 * Wrap storage.local.set / remove / clear so this context's writes reach the
 * snapshot at once. All or nothing: false (and the originals back in place) if
 * any of the three cannot be replaced.
 */
function installWriteObserver(area: chrome.storage.StorageArea): boolean {
  const target = area as unknown as Record<WriteMethod, AnyFn>;
  const record: Record<WriteMethod, (args: unknown[]) => boolean> = {
    set: (args) => recordSet(args[0], typeof args[1] === "function"),
    remove: (args) => recordRemove(args[0], typeof args[1] === "function"),
    clear: (args) => recordClear(typeof args[0] === "function"),
  };
  const replaced: [WriteMethod, AnyFn][] = [];
  const restore = () => {
    for (const [method, original] of replaced) {
      try {
        target[method] = original;
      } catch {
        /* nothing better to do */
      }
    }
  };

  try {
    for (const method of ["set", "remove", "clear"] as const) {
      const original = target[method];
      if (typeof original !== "function") {
        restore();
        return false;
      }
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        let concernsSnapshot = true;
        try {
          concernsSnapshot = record[method](args);
        } catch {
          resetConfigCache();
        }
        let out: unknown;
        try {
          out = Reflect.apply(original, this, args);
        } catch (error) {
          if (concernsSnapshot) resetConfigCache();
          throw error;
        }
        if (
          concernsSnapshot &&
          out !== null &&
          typeof out === "object" &&
          typeof (out as PromiseLike<unknown>).then === "function"
        ) {
          // Same outcome for the caller (value or error), and an unhandled
          // failure is still reported once, as before.
          return (out as Promise<unknown>).then(undefined, (error: unknown) => {
            resetConfigCache();
            throw error;
          });
        }
        return out;
      };
      target[method] = wrapper;
      if (target[method] !== wrapper) {
        restore();
        return false;
      }
      replaced.push([method, original]);
    }
  } catch {
    restore();
    return false;
  }
  return true;
}

function onStorageChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
): void {
  if (area !== "local" || !changes) return;
  for (const key of Object.keys(changes)) {
    if (!SNAPSHOT_KEY_SET.has(key)) continue;
    const change = changes[key];
    if (!change || typeof change !== "object") continue;
    // Copied: the other listeners receive the very same objects.
    applyChange(key, "newValue" in change ? copyRaw(change.newValue) : REMOVED);
  }
}

/** Runs once, when the module is evaluated (see "Ordering" above). */
function initSnapshot(): void {
  try {
    if (typeof chrome === "undefined") return;
    const area = chrome.storage?.local;
    const onChanged = chrome.storage?.onChanged;
    if (!area || typeof onChanged?.addListener !== "function") return;
    if (!installWriteObserver(area)) return;
    cacheEnabled = true;
    onChanged.addListener(onStorageChanged);
  } catch {
    cacheEnabled = false;
  }
}

/**
 * Asynchronously retrieves a configuration value from storage.
 *
 * This generic function is the primary way to access configuration throughout the extension.
 * It returns the stored value for `key` (from the settings snapshot above, or
 * straight from `chrome.storage.local` when there is none). If the value is not
 * found in storage, it returns the corresponding default value from the
 * `CONFIG_DEFAULT` object.
 *
 * It also includes a helpful feature to automatically parse stringified JSON
 * for values that are objects or arrays.
 *
 * @param key The configuration key to retrieve.
 * @returns A promise that resolves to the value of the requested configuration key,
 *          with the correct type inferred from the BetterIntraConfig interface.
 */
export const getConfig = async <T extends ConfigKey>(
  key: T,
): Promise<BetterIntraConfig[T]> => {
  let snap = snapshotFor([key]);
  if (snap instanceof Promise) snap = await snap;
  if (snap) return normalizeConfigValue(key, copyRaw(snap.get(key)));
  const res = await chrome.storage.local.get(key);
  return normalizeConfigValue(key, res ? res[key] : undefined);
};

/**
 * Batched variant of getConfig(): one storage round-trip for several keys.
 * Prefer it when a feature needs many settings at once; awaiting getConfig()
 * fifteen times in a row used to add fifteen serial IPC calls on start-up.
 * With the snapshot both cost nothing once it is loaded; this one still saves
 * the round-trips where there is no snapshot.
 */
export const getConfigMany = async <K extends ConfigKey>(
  keys: readonly K[],
): Promise<Pick<BetterIntraConfig, K>> => {
  let snap = snapshotFor(keys);
  if (snap instanceof Promise) snap = await snap;
  const res: Record<string, unknown> | undefined = snap
    ? undefined
    : await chrome.storage.local.get([...keys]);
  const out = {} as Pick<BetterIntraConfig, K>;
  for (const key of keys) {
    out[key] = snap
      ? normalizeConfigValue(key, copyRaw(snap.get(key)))
      : normalizeConfigValue(key, res ? res[key] : undefined);
  }
  return out;
};

/**
 * Typed write for new call sites: `await setConfig({ LOGTIME_GOAL_HOURS: 150 })`.
 * It is chrome.storage.local.set() and nothing else: the snapshot sees it
 * through the same wrapper as the raw set() calls, so both stay interchangeable.
 */
export const setConfig = async (
  values: Partial<BetterIntraConfig>,
): Promise<void> => {
  await chrome.storage.local.set(values);
};

/** Apply defaults, legacy JSON-string parsing and per-key fix-ups to a raw stored value. */
function normalizeConfigValue<T extends ConfigKey>(
  key: T,
  raw: unknown,
): BetterIntraConfig[T] {
  let value: unknown = raw !== undefined ? raw : CONFIG_DEFAULT[key];

  // Some legacy callers serialize arrays/objects as JSON strings (e.g. hub settings).
  // Parse those back so consumers get the declared type. Only for keys that
  // hold an array or an object: a plain string setting (a bio reading
  // "[insert bio]", a custom CSS block) must survive untouched.
  const wantsStructure =
    CONFIG_DEFAULT[key] === null || typeof CONFIG_DEFAULT[key] === "object";
  if (
    wantsStructure &&
    typeof value === "string" &&
    (value.startsWith("[") || value.startsWith("{"))
  ) {
    try {
      value = JSON.parse(value);
    } catch {
      /* keep string */
    }
  }

  if (key === "PROFILE_CARD_ORDER" && Array.isArray(value)) {
    const stored = value as string[];
    const defaults = CONFIG_DEFAULT.PROFILE_CARD_ORDER;
    const storedSet = new Set(
      stored.map((s) => s.replace(/^-/, "").toUpperCase()),
    );
    for (const def of defaults) {
      if (!storedSet.has(def.toUpperCase())) {
        stored.push(def);
      }
    }
  }

  return value as BetterIntraConfig[T];
}

// Last, so that every binding above is initialised. Registers the onChanged
// listener before any importer can register its own.
initSnapshot();
