/**
 * "Customize" feature: user-level look & feel tweaks applied to every Intra
 * page (v2 and v3):
 *   - custom accent colour (overrides the theme preset's --primary)
 *   - font family and global font scale
 *   - free-form custom CSS
 *
 * Everything is the user's own setting for their own browser (cloud-synced
 * for the same user only), so values are validated for robustness, not
 * against a hostile author.
 */
import { getConfigMany, type BetterIntraConfig } from "../../config.ts";

export const CUSTOMIZE_KEYS = [
  "CUSTOM_ACCENT_ENABLED",
  "CUSTOM_ACCENT_COLOR",
  "CUSTOM_FONT",
  "CUSTOM_FONT_FAMILY",
  "CUSTOM_FONT_SCALE",
  "CUSTOM_RADIUS",
  "CUSTOM_CSS",
] as const;

export type CustomizeConfig = Pick<BetterIntraConfig, (typeof CUSTOMIZE_KEYS)[number]>;

const STYLE_ID = "better-intra-customize";
const CSS_ID = "better-intra-custom-css";

/** Built-in font choices (system fonts only: no external requests). */
export const FONT_PRESETS: Record<string, string> = {
  default: "",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, sans-serif",
  humanist: "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  rounded:
    "'Nunito', 'Varela Round', 'Segoe UI Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, 'DejaVu Sans Mono', monospace",
};

/** #rrggbb -> "H S% L%" (the format the theme variables use). */
export function hexToHslTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Black or white text, whichever contrasts better with the given colour. */
export function contrastForeground(hex: string): "0 0% 0%" | "0 0% 100%" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "0 0% 100%";
  const n = parseInt(m[1], 16);
  const lum = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L =
    0.2126 * lum((n >> 16) & 255) +
    0.7152 * lum((n >> 8) & 255) +
    0.0722 * lum(n & 255);
  return L > 0.4 ? "0 0% 0%" : "0 0% 100%";
}

/** A font-family value safe to interpolate into a declaration. */
export function sanitizeFontFamily(value: unknown): string {
  if (typeof value !== "string") return "";
  const v = value.trim().replace(/[;{}<>\\]/g, "").slice(0, 200);
  return v;
}

/** Clamp the font scale to a sane range (percent). */
export function clampFontScale(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(140, Math.max(70, Math.round(n)));
}

const RADIUS: Record<string, string> = {
  default: "",
  none: "0px",
  small: "0.375rem",
  large: "1rem",
  full: "1.5rem",
};

/** Build the stylesheet for the current customisation settings. */
export function buildCustomizeCss(c: CustomizeConfig): string {
  const rules: string[] = [];

  if (c.CUSTOM_ACCENT_ENABLED) {
    const hsl = hexToHslTriplet(c.CUSTOM_ACCENT_COLOR);
    if (hsl) {
      const fg = contrastForeground(c.CUSTOM_ACCENT_COLOR);
      // v3 theme variables; --legacy-main is used by a few components
      rules.push(
        `html, html.dark, html:not(.dark) { --primary: ${hsl} !important; --ring: ${hsl} !important; --primary-foreground: ${fg} !important; --legacy-main: hsl(${hsl}) !important; }`,
      );
      // v2 intra: the accent is a plain hex in a few places
      rules.push(
        `:root { --better-intra-accent: ${c.CUSTOM_ACCENT_COLOR}; --theme-color: ${c.CUSTOM_ACCENT_COLOR}; }`,
      );
    }
  }

  const family =
    c.CUSTOM_FONT === "custom"
      ? sanitizeFontFamily(c.CUSTOM_FONT_FAMILY)
      : (FONT_PRESETS[c.CUSTOM_FONT] ?? "");
  if (family) {
    // icon fonts keep their family: only text elements are targeted
    rules.push(
      `html, body, button, input, select, textarea, .font-sans { font-family: ${family} !important; }`,
    );
  }

  const scale = clampFontScale(c.CUSTOM_FONT_SCALE);
  if (scale !== 100) {
    rules.push(`html { font-size: ${scale}% !important; }`);
  }

  const radius = RADIUS[c.CUSTOM_RADIUS] ?? "";
  if (radius) {
    rules.push(
      `html { --radius: ${radius} !important; } .rounded-xl, .rounded-lg, .rounded-md, .rounded-2xl, .card, .btn, .input, .select { border-radius: ${radius} !important; }`,
    );
  }

  return rules.join("\n");
}

function setStyle(id: string, css: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    (document.head || document.documentElement).appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

export async function applyCustomizations(): Promise<void> {
  const c = await getConfigMany(CUSTOMIZE_KEYS);
  setStyle(STYLE_ID, buildCustomizeCss(c));
  // custom CSS last so it wins over everything above
  setStyle(CSS_ID, typeof c.CUSTOM_CSS === "string" ? c.CUSTOM_CSS : "");
}

let initialised = false;

export async function initCustomize(): Promise<void> {
  await applyCustomizations();
  if (initialised) return;
  initialised = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (CUSTOMIZE_KEYS.some((k) => k in changes)) void applyCustomizations();
  });
}
