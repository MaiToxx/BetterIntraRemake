/**
 * content.js: the classic content script both manifests declare on
 * https://*.intra.42.fr/* at document_start. It does, synchronously, the
 * little that has to beat the page's own scripts or its first paint, then
 * imports the app (src/main.ts, built as the ES module content-main.js):
 *
 *   1. hook.js goes into the page first, so that it wraps window.fetch before
 *      the Intra app sends its first request (token, campus, logtime payload);
 *   2. the theme cached by the previous page is applied (no light flash);
 *   3. the Intra avatar is hidden as soon as React inserts it, until the
 *      custom one is painted, with a 5 s fail-safe that brings it back even if
 *      the app never loads;
 *   4. import(chrome.runtime.getURL("content-main.js")).
 *
 * RULES (docs/CODE-SPLITTING.md, "Exactly one instance of every stateful
 * module"). This file holds no state: no chrome.storage, no settings, no
 * module-level variable, and it imports only modules made of constants
 * (selectors.ts). Everything with state lives in the ES module graph, which
 * the browser evaluates once per page. The app has ONE URL, the one in
 * loadApp(), with no query string and no hash: every lazy chunk imports
 * "../content-main.js", and a second URL would be a second instance of the
 * whole app. tests/split-build.test.ts checks the built file.
 *
 * The import() argument is written as the getURL() call itself, not through
 * a variable: addons-linter flags import() of a variable.
 */
import { AVATAR_SELECTOR } from "./core/intra/selectors.ts";

/**
 * The page theme sheets, with the same names and files as THEME_SHEETS in
 * src/core/theme/theme-manager.ts, which adopts the <link> made here (it finds
 * it by its data-better-intra-theme name). tests/loader.test.ts holds the two
 * copies together.
 */
const THEME_SHEETS = {
  darkV2: "theme-dark-v2.css",
  darkV3: "theme-dark-v3.css",
  lightV3: "theme-light-default-v3.css",
} as const;
/** STYLESHEET_ID in theme-manager.ts: the page sheet that is on. */
const STYLESHEET_ID = "better-intra-theme-stylesheet";
/** Written by theme-manager.ts applyTheme(); only read here. */
const THEME_CACHE_KEY = "intra-theme";
const V3_HOST = "profile-v3.intra.42.fr";

function injectHook(): void {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("hook.js");
  (document.head || document.documentElement).appendChild(s);
  s.remove();
}

function linkThemeSheet(name: keyof typeof THEME_SHEETS): void {
  let href: string;
  try {
    href = chrome.runtime.getURL(THEME_SHEETS[name]);
  } catch {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.betterIntraTheme = name;
  link.id = STYLESHEET_ID;
  (document.head || document.documentElement).appendChild(link);
}

/**
 * The synchronous part of applyTheme() in theme-manager.ts, for the theme the
 * previous page cached: the `dark` class, data-theme on v3 and the page theme
 * sheet. It never writes sessionStorage and does not build the colour preset
 * <style>, which needs a settings read: theme-manager.ts does both a moment
 * later, as it did when it ran at document_start. Blocked storage or no cache:
 * nothing here, and the app applies the theme when it has read the settings.
 */
function applyCachedTheme(): void {
  let theme: string | null;
  try {
    theme = sessionStorage.getItem(THEME_CACHE_KEY);
  } catch {
    return;
  }
  if (!theme) return;
  const isDark = theme === "dark";
  const isV3 = location.hostname === V3_HOST;
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  if (isV3) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  if (document.body) document.body.classList.toggle("dark", isDark);
  if (isV3) linkThemeSheet(isDark ? "darkV3" : "lightV3");
  else if (isDark) linkThemeSheet("darkV2");
}

/**
 * The observer only sees added nodes, so it has to be watching before React
 * inserts the avatar: started later, the Intra picture would flash before the
 * custom one. The profile visuals (visuals.ts) reveal it once it is painted.
 */
function hideIntraAvatar(): void {
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        let target: HTMLElement | null = null;
        if (node.matches?.(AVATAR_SELECTOR)) target = node;
        else target = node.querySelector?.(AVATAR_SELECTOR);
        if (target) {
          target.style.setProperty("opacity", "0", "important");
          obs.disconnect();
          return;
        }
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // Here and not in the app: the avatar must come back even if the app fails.
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(AVATAR_SELECTOR);
    if (el) el.style.setProperty("opacity", "1", "important");
  }, 5000);
}

function loadApp(): void {
  let app: Promise<unknown>;
  try {
    // The app entry, next to this file in the package, by its one URL.
    app = import(/* @vite-ignore */ chrome.runtime.getURL("content-main.js"));
  } catch {
    return; // extension context invalidated (reloaded under this tab)
  }
  app.catch((err: unknown) => {
    console.warn("Better Intra: the extension could not start on this page.", err);
  });
}

injectHook();
applyCachedTheme();
hideIntraAvatar();
loadApp();
