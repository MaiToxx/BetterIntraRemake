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

/**
 * Asynchronously retrieves a configuration value from storage.
 *
 * This generic function is the primary way to access configuration throughout the extension.
 * It fetches the value for the given `key` from `chrome.storage.local`.
 * If the value is not found in storage, it returns the corresponding default value
 * from the `CONFIG_DEFAULT` object.
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
  const res = await chrome.storage.local.get(key);
  return normalizeConfigValue(key, res ? res[key] : undefined);
};

/**
 * Batched variant of getConfig(): one storage round-trip for several keys.
 * Prefer it when a feature needs many settings at once; awaiting getConfig()
 * fifteen times in a row used to add fifteen serial IPC calls on start-up.
 */
export const getConfigMany = async <K extends ConfigKey>(
  keys: readonly K[],
): Promise<Pick<BetterIntraConfig, K>> => {
  const res = await chrome.storage.local.get([...keys]);
  const out = {} as Pick<BetterIntraConfig, K>;
  for (const key of keys) {
    out[key] = normalizeConfigValue(key, res ? res[key] : undefined);
  }
  return out;
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
