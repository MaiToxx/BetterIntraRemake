import { html, nothing, type TemplateResult } from "lit-html";

/**
 * The compiled Tailwind/daisyUI sheet weighs ~165 KB (~300 KB before
 * style.css limited what Tailwind scans and what daisyUI builds). Concatenating
 * it into a <style> inside every shadow root meant the browser tokenised and
 * parsed all of it once per widget on every page load, and both JS bundles had
 * to carry the text.
 *
 * It now ships as a real `shared-styles.css` file next to content.js (the bare
 * import below plus `cssCodeSplit: false` in vite.config.ts is what makes Vite
 * emit it) and is shared: fetched once, parsed once into a constructable
 * CSSStyleSheet, then handed to every root.
 */

// Side-effect import: this is the only reason the asset exists in the output.
// Nothing reads a value from it.
import "./style.css";

/** Name of the emitted asset; must match `assetFileNames` in vite.config.ts. */
const SHARED_CSS_FILE = "shared-styles.css";

let sharedSheet: CSSStyleSheet | null = null;
let sheetPromise: Promise<CSSStyleSheet | null> | null = null;

/** Roots already served, so a second call is a no-op instead of a duplicate. */
const served = new WeakSet<ShadowRoot>();

/**
 * Extension URL of the sheet, or null when there is no extension context
 * (unit tests, or a context invalidated by a reload/update). Callers degrade to
 * "unstyled but working" rather than throwing.
 */
export function sharedStylesURL(): string | null {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.getURL) return null;
    return chrome.runtime.getURL(SHARED_CSS_FILE);
  } catch {
    return null;
  }
}

/** Safari < 16.4 and old Firefox have no constructable stylesheets. */
function supportsConstructableSheets(): boolean {
  const Ctor = (globalThis as { CSSStyleSheet?: typeof CSSStyleSheet })
    .CSSStyleSheet;
  return (
    typeof Ctor === "function" && typeof Ctor.prototype?.replaceSync === "function"
  );
}

async function loadSharedSheet(url: string): Promise<CSSStyleSheet | null> {
  if (!supportsConstructableSheets() || typeof fetch !== "function") return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(await res.text());
    sharedSheet = sheet;
    return sheet;
  } catch {
    // Network/context failure: adoptSharedStyles() falls back to <link>, and if
    // that fails too the widget renders unstyled instead of not at all.
    return null;
  }
}

/**
 * Fetch and parse the sheet once for the whole page. Memoised, so calling it
 * from anywhere is free after the first time.
 */
export function preloadSharedStyles(): Promise<CSSStyleSheet | null> {
  if (sheetPromise) return sheetPromise;
  const url = sharedStylesURL();
  // No extension context yet: do not memoise a failure, a later call may work.
  if (!url) return Promise.resolve(null);
  sheetPromise = loadSharedSheet(url);
  return sheetPromise;
}

/**
 * Give `root` the shared sheet, followed by the widget's own `extraCSS` (the
 * rules that used to sit after `sharedCSS` in the same <style>).
 *
 * Use this only when this helper owns *every* stylesheet of the root: adopted
 * sheets are applied AFTER the root's own <style>/<link> elements, so a root
 * that also renders its own <style> would see those rules start losing ties to
 * Tailwind. Such roots must use {@link sharedStylesLink} instead.
 */
export function adoptSharedStyles(root: ShadowRoot, extraCSS?: string): void {
  if (served.has(root)) return;
  served.add(root);
  void preloadSharedStyles();
  if (sharedSheet && adopt(root, sharedSheet, extraCSS)) return;
  appendFallback(root, extraCSS);
}

function adopt(
  root: ShadowRoot,
  sheet: CSSStyleSheet,
  extraCSS?: string,
): boolean {
  try {
    const sheets: CSSStyleSheet[] = [sheet];
    if (extraCSS) {
      const own = new CSSStyleSheet();
      own.replaceSync(extraCSS);
      // After the shared sheet, so the widget's rules keep winning ties exactly
      // as they did when both strings were concatenated into one <style>.
      sheets.push(own);
    }
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets];
    return true;
  } catch {
    return false;
  }
}

/**
 * The sheet is not ready (or not supported): a <link> keeps the widget styled.
 * Both nodes go first in the root so the cascade order is unchanged.
 */
function appendFallback(root: ShadowRoot, extraCSS?: string): void {
  const nodes: Node[] = [];
  const url = sharedStylesURL();
  if (url) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    nodes.push(link);
  }
  if (extraCSS) {
    const style = document.createElement("style");
    style.textContent = extraCSS;
    nodes.push(style);
  }
  if (nodes.length) root.prepend(...nodes);
}

/**
 * lit binding for shadow roots that keep their own rules in a <style> inside
 * the template. A <link> is a tree stylesheet, so placing it before that
 * <style> reproduces the old cascade exactly, which adoption cannot do. The
 * file is already in the HTTP cache thanks to {@link preloadSharedStyles}, and
 * both engines share the parsed sheet between roots pointing at the same URL.
 */
export function sharedStylesLink(): TemplateResult | typeof nothing {
  const url = sharedStylesURL();
  if (!url) return nothing;
  return html`<link rel="stylesheet" href="${url}" />`;
}

// Start the fetch as early as the content script itself: this module sits in
// the static import graph of main.ts, so it runs at document_start and the
// sheet is normally parsed long before the first widget mounts.
void preloadSharedStyles();
