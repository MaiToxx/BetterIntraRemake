import { getConfig } from "../config.ts";
import themesJson from "./themes.json";
import { VISITOR_PRESET_EVENT } from "./theme-events.ts";
import { THEME_MODES } from "./theme-ids.ts";

type ThemeModeVars = {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  popover: string;
  popoverForeground: string;
  accent: string;
  accentForeground: string;
  border: string;
  input: string;
};

type ThemePreset = {
  primary: string;
  primaryForeground: string;
  ring: string;
  dark?: ThemeModeVars;
  light?: ThemeModeVars;
};

export const THEMES: Record<string, ThemePreset> = themesJson;

/**
 * The mode a named preset puts the page in, or null for the plain "dark" and
 * "light" presets (and unknown keys), which follow BETTER_INTRA_THEME. A
 * preset only has variables for one mode: before 1.14.0 a dark preset picked
 * while the page was light (or the reverse) silently did nothing.
 */
export function presetMode(key: string | null | undefined): "dark" | "light" | null {
  if (!key || key === "dark" || key === "light") return null;
  // the small generated table, not THEMES: the popup reads the mode too and
  // must not carry the colour table
  return Object.hasOwn(THEME_MODES, key) ? THEME_MODES[key] : null;
}

/**
 * The preset of the profile being visited, when its owner published one and
 * the viewer shows other people's looks (see setVisitorPreset). Never stored.
 */
let visitorPreset: string | null = null;

/** The preset in force on this page: the visited profile's, else the user's. */
export async function getActivePreset(): Promise<string> {
  return visitorPreset ?? ((await getConfig("PROFILE_THEME_PRESET")) || "dark");
}

function toKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

const STYLESHEET_ID = "better-intra-theme-stylesheet";
const PRESET_ID = "better-intra-theme-preset";

/**
 * The theme sheets ship as files in the extension package instead of as JS
 * strings inlined in content.js (theme-dark-v2.css alone is 55 KB that
 * profile-v3 never needs). Each <link> is created the first time its sheet is
 * actually wanted and then kept for good, switched on and off through `media`,
 * so changing theme costs no refetch and stays instant.
 *
 * Keep in sync with THEME_CSS_FILES in vite.config.ts and with
 * web_accessible_resources in both manifests.
 */
const THEME_SHEETS = {
  darkV2: "theme-dark-v2.css",
  darkV3: "theme-dark-v3.css",
  lightV3: "theme-light-default-v3.css",
  lightPresetOverrides: "theme-light-v3.css",
} as const;

type ThemeSheet = keyof typeof THEME_SHEETS;
/** The three that are mutually exclusive; the fourth rides on top of a preset. */
type PageThemeSheet = Exclude<ThemeSheet, "lightPresetOverrides">;

const themeLinks = new Map<ThemeSheet, HTMLLinkElement>();

function themeSheetURL(name: ThemeSheet): string | null {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.getURL) return null;
    return chrome.runtime.getURL(THEME_SHEETS[name]);
  } catch {
    // Context invalidated by a reload/update: leave the page as it is.
    return null;
  }
}

function themeLink(name: ThemeSheet): HTMLLinkElement | null {
  const existing = themeLinks.get(name);
  if (existing) return existing;
  const url = themeSheetURL(name);
  if (!url) return null;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.betterIntraTheme = name;
  (document.head || document.documentElement).appendChild(link);
  themeLinks.set(name, link);
  return link;
}

/** `media="not all"` keeps a sheet loaded but inert, so toggling it is instant. */
function setSheetEnabled(link: HTMLLinkElement, on: boolean): void {
  link.media = on ? "all" : "not all";
}

/**
 * Enable exactly one page-level theme sheet, or none. A sheet that was never
 * asked for is never created, which is what keeps the v2 sheet off profile-v3.
 */
function usePageThemeSheet(name: PageThemeSheet | null): void {
  for (const [key, link] of themeLinks) {
    if (key === "lightPresetOverrides") continue;
    setSheetEnabled(link, key === name);
    if (key !== name && link.id === STYLESHEET_ID) link.removeAttribute("id");
  }
  if (!name) return;
  const link = themeLink(name);
  if (!link) return;
  setSheetEnabled(link, true);
  link.id = STYLESHEET_ID;
}

/**
 * The light-preset overrides used to be appended after the generated variables
 * inside the same <style>, so they must stay after it in the document to keep
 * winning the same ties.
 */
function useLightPresetOverrides(on: boolean, after: HTMLElement): void {
  if (!on) {
    const existing = themeLinks.get("lightPresetOverrides");
    if (existing) setSheetEnabled(existing, false);
    return;
  }
  const link = themeLink("lightPresetOverrides");
  if (!link) return;
  if (link.previousElementSibling !== after) after.insertAdjacentElement("afterend", link);
  setSheetEnabled(link, true);
}

async function applyThemePreset() {
  const presetKey = await getActivePreset();
  const isDark = document.documentElement.classList.contains("dark");

  let styleEl = document.getElementById(
    PRESET_ID,
  ) as HTMLStyleElement | null;

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = PRESET_ID;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  if (!presetKey || presetKey === "dark" || presetKey === "light") {
    styleEl.textContent = "";
    useLightPresetOverrides(false, styleEl);
    return;
  }

  const preset = THEMES[presetKey];
  if (!preset) {
    styleEl.textContent = "";
    useLightPresetOverrides(false, styleEl);
    return;
  }

  const { primary, primaryForeground, ring } = preset;
  let content = "";
  let wantsLightOverrides = false;

  if (isDark && preset.dark) {
    const vars = [
      `--primary: ${primary}`,
      `--primary-foreground: ${primaryForeground}`,
      `--ring: ${ring}`,
    ];
    for (const [key, val] of Object.entries(preset.dark)) {
      vars.push(`--${toKebab(key)}: ${val}`);
    }
    content = `html.dark {\n    ${vars.join(";\n    ")};\n  }`;
  } else if (!isDark && preset.light) {
    const vars = [
      `--primary: ${primary}`,
      `--primary-foreground: ${primaryForeground}`,
      `--ring: ${ring}`,
      `--legacy-main: var(--primary)`,
    ];
    for (const [key, val] of Object.entries(preset.light)) {
      vars.push(`--${toKebab(key)}: ${val}`);
    }
    content = `html:not(.dark) {\n    ${vars.join(";\n    ")};\n  }`;
    wantsLightOverrides = true;
  }

  styleEl.textContent = content;
  useLightPresetOverrides(wantsLightOverrides, styleEl);
}

/**
 * `remember`: keep the mode for the next page's first paint. Off while a
 * visited profile's theme is shown, which must not follow the viewer around.
 */
function applyTheme(theme: "dark" | "light", remember = true) {
  const isDark = theme === "dark";
  const isV3 = window.location.hostname === "profile-v3.intra.42.fr";

  if (!isV3) {
    const presetEl = document.getElementById(PRESET_ID);
    if (presetEl) presetEl.remove();
    usePageThemeSheet(isDark ? "darkV2" : null);
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.removeAttribute("data-theme");
    if (document.body) document.body.classList.toggle("dark", isDark);
    if (remember) sessionStorage.setItem("intra-theme", theme);
    return;
  }

  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.setAttribute("data-theme", theme);
  if (document.body) {
    document.body.classList.toggle("dark", isDark);
  }

  usePageThemeSheet(isDark ? "darkV3" : "lightV3");

  void applyThemePreset();

  if (remember) sessionStorage.setItem("intra-theme", theme);
}

export async function getEffectiveTheme(): Promise<"dark" | "light"> {
  const fromPreset = presetMode(await getActivePreset());
  if (fromPreset) return fromPreset;
  const savedTheme = await getConfig("BETTER_INTRA_THEME");

  if (savedTheme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  return (savedTheme as "dark" | "light") || "light";
}

export async function getIsLight(): Promise<boolean> {
  return (await getEffectiveTheme()) === "light";
}

let themeManagerInitialized = false;

export async function initThemeManager() {
  const cachedTheme = sessionStorage.getItem("intra-theme") as
    | "dark"
    | "light"
    | null;
  if (cachedTheme) {
    applyTheme(cachedTheme);
  }
  const initialTheme = await getEffectiveTheme();
  if (initialTheme !== cachedTheme) {
    applyTheme(initialTheme);
  }

  if (themeManagerInitialized) return;
  themeManagerInitialized = true;

  document.addEventListener(VISITOR_PRESET_EVENT, (e) => {
    void setVisitorPreset((e as CustomEvent<string | null>).detail ?? null);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.BETTER_INTRA_THEME) {
      sessionStorage.removeItem("intra-theme");
      void initThemeManager().then(notifyThemeChange);
    }
    if (area === "local" && changes.PROFILE_THEME_PRESET) {
      // the mode may change with the preset (it follows the preset's own)
      void getEffectiveTheme().then((theme) => {
        applyTheme(theme, !visitorPreset);
        return notifyThemeChange();
      });
    }
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", async (e) => {
      const savedTheme = await getConfig("BETTER_INTRA_THEME");
      if (savedTheme === "system" && !presetMode(await getActivePreset())) {
        applyTheme(e.matches ? "dark" : "light");
        await notifyThemeChange();
      }
    });
}

// ---------------------------------------------------------------------------
// Theme changes for the shadow-root widgets
// ---------------------------------------------------------------------------
//
// applyTheme() restyles the Intra page live, but every widget in a shadow root
// (hub, logtime, friends, profile card) carries its own data-theme, read once
// at mount. This one event, sent after the page is restyled, is what they
// re-read it from; it is not sent at start-up, when they mount with the right
// theme already.

export const THEME_CHANGED_EVENT = "42_THEME_CHANGED";

export interface ThemeChange {
  theme: "dark" | "light";
  /** The PROFILE_THEME_PRESET key ("dark" when unset). */
  preset: string;
}

async function notifyThemeChange(): Promise<void> {
  const [theme, preset] = await Promise.all([getEffectiveTheme(), getActivePreset()]);
  document.dispatchEvent(
    new CustomEvent<ThemeChange>(THEME_CHANGED_EVENT, {
      detail: { theme, preset: preset || "dark" },
    }),
  );
}

/**
 * Show the theme a visited profile's owner published (null: back to the
 * viewer's own). Only named presets apply: everyone who syncs publishes the
 * default "dark", which says nothing about their taste. The page switches to
 * the preset's mode for the visit, without remembering it for the next page,
 * and the widgets follow through the usual theme-change event.
 */
export async function setVisitorPreset(key: string | null): Promise<void> {
  const next = key && presetMode(key) ? key : null;
  if (next === visitorPreset) return;
  visitorPreset = next;
  applyTheme(await getEffectiveTheme(), !next);
  await notifyThemeChange();
}

/** Calls `cb` on every theme change; returns the unsubscribe function. */
export function onThemeChange(cb: (change: ThemeChange) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ThemeChange>).detail);
  document.addEventListener(THEME_CHANGED_EVENT, handler);
  return () => document.removeEventListener(THEME_CHANGED_EVENT, handler);
}

/**
 * The daisyUI theme a widget sets as data-theme: a named preset as is, the
 * plain light/dark presets follow the effective theme.
 */
export function widgetTheme(theme: "dark" | "light", preset: string): string {
  return preset !== "dark" && preset !== "light" ? preset : theme;
}
