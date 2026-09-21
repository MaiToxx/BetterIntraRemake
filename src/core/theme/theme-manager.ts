import { getConfig } from "../config.ts";
import themesJson from "./themes.json";

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

function toKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * The id of the page theme sheet that is on. src/loader.ts, which applies the
 * cached theme at document_start, uses the same id, the same sheet names and
 * file names (THEME_SHEETS) and the same `data-better-intra-theme` attribute:
 * tests/loader.test.ts holds the two copies together.
 */
export const STYLESHEET_ID = "better-intra-theme-stylesheet";
const PRESET_ID = "better-intra-theme-preset";

/**
 * The theme sheets ship as files in the extension package instead of as JS
 * strings inlined in content.js (theme-dark-v2.css alone is 55 KB that
 * profile-v3 never needs). Each <link> is created the first time its sheet is
 * actually wanted and then kept for good, switched on and off through `media`,
 * so changing theme costs no refetch and stays instant.
 *
 * Keep in sync with THEME_CSS_FILES in vite.config.ts, with
 * web_accessible_resources in both manifests and with src/loader.ts.
 */
export const THEME_SHEETS = {
  darkV2: "theme-dark-v2.css",
  darkV3: "theme-dark-v3.css",
  lightV3: "theme-light-default-v3.css",
  lightPresetOverrides: "theme-light-v3.css",
} as const;

type ThemeSheet = keyof typeof THEME_SHEETS;
/** The three that are mutually exclusive; the fourth rides on top of a preset. */
type PageThemeSheet = Exclude<ThemeSheet, "lightPresetOverrides">;

const themeLinks = new Map<ThemeSheet, HTMLLinkElement>();
let loaderLinksAdopted = false;

/**
 * Take over the <link>s that src/loader.ts created at document_start for the
 * cached theme, before this module creates or switches any sheet. Without
 * this, the first theme applied here would add a second link for the same
 * sheet, and a later switch would only turn off its own: the loader's would
 * stay on (stuck dark). One link per sheet is kept; a duplicate (left by a
 * previous instance of the content script) is removed.
 */
function adoptLoaderLinks(): void {
  if (loaderLinksAdopted) return;
  loaderLinksAdopted = true;
  const links = document.querySelectorAll<HTMLLinkElement>("link[data-better-intra-theme]");
  for (const link of links) {
    const name = link.dataset.betterIntraTheme as ThemeSheet;
    if (!Object.prototype.hasOwnProperty.call(THEME_SHEETS, name)) continue;
    if (themeLinks.has(name)) {
      link.remove();
      continue;
    }
    themeLinks.set(name, link);
  }
}

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
  adoptLoaderLinks();
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
  adoptLoaderLinks();
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
  adoptLoaderLinks();
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
  const presetKey = await getConfig("PROFILE_THEME_PRESET");
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

function applyTheme(theme: "dark" | "light") {
  const isDark = theme === "dark";
  const isV3 = window.location.hostname === "profile-v3.intra.42.fr";

  if (!isV3) {
    const presetEl = document.getElementById(PRESET_ID);
    if (presetEl) presetEl.remove();
    usePageThemeSheet(isDark ? "darkV2" : null);
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.removeAttribute("data-theme");
    if (document.body) document.body.classList.toggle("dark", isDark);
    sessionStorage.setItem("intra-theme", theme);
    return;
  }

  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.setAttribute("data-theme", theme);
  if (document.body) {
    document.body.classList.toggle("dark", isDark);
  }

  usePageThemeSheet(isDark ? "darkV3" : "lightV3");

  void applyThemePreset();

  sessionStorage.setItem("intra-theme", theme);
}

export async function getEffectiveTheme(): Promise<"dark" | "light"> {
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

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.BETTER_INTRA_THEME) {
      sessionStorage.removeItem("intra-theme");
      initThemeManager();
    }
    if (area === "local" && changes.PROFILE_THEME_PRESET) {
      void applyThemePreset();
    }
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", async (e) => {
      const savedTheme = await getConfig("BETTER_INTRA_THEME");
      if (savedTheme === "system") {
        applyTheme(e.matches ? "dark" : "light");
      }
    });
}
