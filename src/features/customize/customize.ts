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
import { sanitizeCssUrl } from "../profile/visuals-sanitize.ts";

/** Elements the Intra v3 theme paints with the page background colour. */
const PAGE_SURFACES =
  "html, body, main, footer, header, #root, #root > div, [class*=\"min-h-screen\"]";
/** Selector used by the theme for dashboard/profile cards. */
const CARD_SURFACES = "div.bg-white, .bg-white.md\\:h-96";
/** Profile avatar (kept in sync with selectors.ts AVATAR_SELECTOR). */
const AVATAR = "div.rounded-full.w-52.h-52";

/** "H S% L%" -> the same with the lightness shifted (clamped 0-100). */
export function shiftLightness(hsl: string, delta: number): string {
  const m = /^(\d+) (\d+)% (\d+)%$/.exec(hsl);
  if (!m) return hsl;
  const l = Math.min(100, Math.max(0, Number(m[3]) + delta));
  return `${m[1]} ${m[2]}% ${l}%`;
}

const AVATAR_RADIUS: Record<string, string> = {
  circle: "",
  rounded: "1.25rem",
  square: "0",
};

export const CUSTOMIZE_KEYS = [
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
] as const;

/** Built-in page backgrounds (CSS gradients, no image hosting needed). */
export const BG_PRESETS: Record<string, string> = {
  none: "",
  aurora:
    "radial-gradient(at 20% 10%, #1a2a6c 0%, transparent 55%), radial-gradient(at 80% 20%, #b21f1f33 0%, transparent 50%), radial-gradient(at 50% 90%, #0f9b8e 0%, transparent 55%), #0b0f1a",
  sunset:
    "linear-gradient(160deg, #2b1055 0%, #7597de 45%, #ffb88c 100%)",
  ocean:
    "linear-gradient(180deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
  forest:
    "linear-gradient(160deg, #0b3d2e 0%, #14532d 50%, #1a2e1a 100%)",
  mono: "linear-gradient(180deg, #111111 0%, #2a2a2a 100%)",
};

const CARD_STYLES: Record<string, string> = {
  default: "",
  flat: "box-shadow: none !important; border: none !important;",
  soft: "box-shadow: 0 8px 24px rgba(0,0,0,0.18) !important; border: none !important;",
  strong: "box-shadow: 0 16px 48px rgba(0,0,0,0.45) !important; border: none !important;",
  outlined:
    "box-shadow: none !important; border: 1px solid hsl(var(--primary) / 0.45) !important;",
};

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

  // Full custom palette: the v3 theme paints everything through these
  // variables, so overriding them recolours the whole interface. Secondary
  // tones (muted, border, input, popover, accent) derive from the two
  // surfaces so a single pair of colours stays coherent.
  if (c.CUSTOM_THEME_ENABLED) {
    const bg = hexToHslTriplet(c.CUSTOM_THEME_BG);
    const card = hexToHslTriplet(c.CUSTOM_THEME_CARD);
    const text = hexToHslTriplet(c.CUSTOM_THEME_TEXT);
    if (bg && card && text) {
      const dark = Number(/(\d+)%$/.exec(bg)?.[1] ?? 50) < 50;
      const step = dark ? 6 : -6;
      const vars = [
        `--background: ${bg}`,
        `--card: ${card}`,
        `--popover: ${card}`,
        `--foreground: ${text}`,
        `--card-foreground: ${text}`,
        `--popover-foreground: ${text}`,
        `--accent-foreground: ${text}`,
        `--muted: ${shiftLightness(bg, step)}`,
        `--muted-foreground: ${shiftLightness(text, dark ? -25 : 25)}`,
        `--accent: ${shiftLightness(card, step * 1.5)}`,
        `--border: ${shiftLightness(card, step * 1.5)}`,
        `--input: ${shiftLightness(card, step / 2)}`,
      ].map((v) => `${v} !important`);
      rules.push(`html, html.dark, html:not(.dark) { ${vars.join("; ")}; }`);
    }
  }

  // Page background image with a dim overlay; page surfaces become
  // transparent so the picture shows through, cards keep their colour at the
  // chosen opacity.
  const pageBg = sanitizeCssUrl(c.CUSTOM_PAGE_BG_URL);
  if (pageBg) {
    const dim = Math.min(90, Math.max(0, Math.round(num(c.CUSTOM_PAGE_BG_DIM, 40)))) / 100;
    rules.push(
      `html, html.dark, html:not(.dark) { background: linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${pageBg}") center / cover fixed no-repeat !important; }`,
    );
    rules.push(
      `${PAGE_SURFACES.split(", ").filter((s) => s !== "html").map((s) => `html.dark ${s}, html:not(.dark) ${s}`).join(", ")} { background-color: transparent !important; background-image: none !important; }`,
    );
  }

  const cardOpacity = Math.min(100, Math.max(30, Math.round(num(c.CUSTOM_CARD_OPACITY, 100))));
  if (cardOpacity !== 100 || pageBg) {
    const alpha = (cardOpacity / 100).toFixed(2);
    rules.push(
      `html.dark ${CARD_SURFACES.split(", ").join(", html.dark ")} { background-color: hsl(var(--card) / ${alpha}) !important; backdrop-filter: blur(8px); }`,
    );
  }

  const avatarRadius = AVATAR_RADIUS[c.CUSTOM_AVATAR_SHAPE] ?? "";
  if (avatarRadius !== "" && c.CUSTOM_AVATAR_SHAPE !== "circle") {
    rules.push(`${AVATAR} { border-radius: ${avatarRadius} !important; }`);
  }

  // Built-in gradient background (only when no image is set; same surface
  // handling as the image).
  const gradient = BG_PRESETS[c.CUSTOM_PAGE_BG_PRESET] ?? "";
  if (!pageBg && gradient) {
    rules.push(
      `html, html.dark, html:not(.dark) { background: ${gradient} fixed !important; }`,
    );
    rules.push(
      `${PAGE_SURFACES.split(", ").filter((s) => s !== "html").map((s) => `html.dark ${s}, html:not(.dark) ${s}`).join(", ")} { background-color: transparent !important; background-image: none !important; }`,
    );
    if (cardOpacity === 100) {
      rules.push(
        `html.dark ${CARD_SURFACES.split(", ").join(", html.dark ")} { background-color: hsl(var(--card) / 0.92) !important; }`,
      );
    }
  }

  const cardStyle = CARD_STYLES[c.CUSTOM_CARD_STYLE] ?? "";
  if (cardStyle) {
    rules.push(`${CARD_SURFACES}, .card { ${cardStyle} }`);
  }

  if (c.CUSTOM_SCROLLBAR && c.CUSTOM_SCROLLBAR !== "default") {
    if (c.CUSTOM_SCROLLBAR === "hidden") {
      rules.push(
        `html { scrollbar-width: none !important; } html::-webkit-scrollbar { width: 0 !important; height: 0 !important; }`,
      );
    } else {
      const thumb =
        c.CUSTOM_SCROLLBAR === "accent" ? "hsl(var(--primary))" : "rgba(128,128,128,0.55)";
      rules.push(
        `html { scrollbar-width: thin !important; scrollbar-color: ${thumb} transparent !important; } ::-webkit-scrollbar { width: 8px; height: 8px; } ::-webkit-scrollbar-thumb { background: ${thumb}; border-radius: 8px; } ::-webkit-scrollbar-track { background: transparent; }`,
      );
    }
  }

  return rules.join("\n");
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
