/**
 * "Customize" feature: user-level look & feel tweaks applied to every Intra
 * page (v2 and v3):
 *   - custom accent colour (overrides the theme preset's --primary), with an
 *     optional second colour for a gradient
 *   - font family, global font scale, density
 *   - full palette, page background (image or built-in gradient), card style
 *   - free-form custom CSS
 *
 * Everything is the user's own setting for their own browser (cloud-synced
 * for the same user only), so values are validated for robustness, not
 * against a hostile author. The one exception is the "visitor look": the
 * subset of these settings another user publishes on their profile (see
 * public-look.ts), which is validated key by key before reaching this file.
 */
import { CONFIG_DEFAULT, getConfigMany, type BetterIntraConfig } from "../../config.ts";
import { sanitizeCssUrl } from "../../utils/css-sanitize.ts";

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

export const AVATAR_RADIUS: Record<string, string> = {
  circle: "",
  rounded: "1.25rem",
  square: "0",
};

export const CUSTOMIZE_KEYS = [
  "CUSTOM_ACCENT_ENABLED",
  "CUSTOM_ACCENT_COLOR",
  "CUSTOM_ACCENT_GRADIENT",
  "CUSTOM_ACCENT_COLOR_2",
  "CUSTOM_FONT",
  "CUSTOM_FONT_FAMILY",
  "CUSTOM_FONT_SCALE",
  "CUSTOM_RADIUS",
  "CUSTOM_DENSITY",
  "CUSTOM_HIDE_FOOTER",
  "CUSTOM_CSS",
  "CUSTOM_THEME_ENABLED",
  "CUSTOM_THEME_BG",
  "CUSTOM_THEME_CARD",
  "CUSTOM_THEME_TEXT",
  "CUSTOM_PAGE_BG_URL",
  "CUSTOM_PAGE_BG_DIM",
  "CUSTOM_PAGE_BG_PRESET",
  "CUSTOM_BG_ANIMATE",
  "CUSTOM_CARD_OPACITY",
  "CUSTOM_CARD_STYLE",
  "CUSTOM_AVATAR_SHAPE",
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
  midnight:
    "linear-gradient(180deg, #020617 0%, #0f172a 55%, #1e1b4b 100%)",
  candy:
    "linear-gradient(135deg, #ff9a9e 0%, #fad0c4 40%, #a18cd1 100%)",
  lava: "linear-gradient(160deg, #1a0000 0%, #7a1010 50%, #ff6a00 100%)",
  nord: "linear-gradient(180deg, #2e3440 0%, #3b4252 50%, #434c5e 100%)",
  dracula:
    "linear-gradient(160deg, #282a36 0%, #44475a 55%, #6272a4 100%)",
  teal: "linear-gradient(160deg, #001b1b 0%, #004d4d 50%, #00babc 100%)",
  space:
    "radial-gradient(circle at 15% 20%, rgba(255,255,255,0.12) 0 1px, transparent 2px), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.10) 0 1px, transparent 2px), radial-gradient(circle at 40% 85%, rgba(255,255,255,0.08) 0 1px, transparent 2px), radial-gradient(at 80% 0%, #1d0b3a 0%, transparent 60%), #05030f",
  mesh:
    "radial-gradient(at 0% 0%, #7c3aed66 0%, transparent 50%), radial-gradient(at 100% 0%, #06b6d466 0%, transparent 50%), radial-gradient(at 100% 100%, #f43f5e55 0%, transparent 50%), radial-gradient(at 0% 100%, #22c55e55 0%, transparent 50%), #0b0f1a",
};

export const CARD_STYLES: Record<string, string> = {
  default: "",
  flat: "box-shadow: none !important; border: none !important;",
  soft: "box-shadow: 0 8px 24px rgba(0,0,0,0.18) !important; border: none !important;",
  strong: "box-shadow: 0 16px 48px rgba(0,0,0,0.45) !important; border: none !important;",
  outlined:
    "box-shadow: none !important; border: 1px solid hsl(var(--primary) / 0.45) !important;",
  glass:
    "background-color: hsl(var(--card) / 0.55) !important; backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); border: 1px solid rgba(255,255,255,0.08) !important; box-shadow: 0 8px 32px rgba(0,0,0,0.25) !important;",
  stripe:
    "border-left: 4px solid hsl(var(--primary)) !important; box-shadow: 0 4px 16px rgba(0,0,0,0.15) !important;",
};

/**
 * Spacing presets. The v3 pages are built with Tailwind utilities, so the
 * densities re-map the handful of gap/padding classes the layout uses.
 */
export const DENSITY: Record<string, string> = {
  default: "",
  compact:
    ".gap-6 { gap: 1rem !important; } .gap-4 { gap: 0.625rem !important; } .gap-3 { gap: 0.5rem !important; } .p-6 { padding: 1rem !important; } .p-4 { padding: 0.75rem !important; } .px-6 { padding-left: 1rem !important; padding-right: 1rem !important; } .py-4 { padding-top: 0.5rem !important; padding-bottom: 0.5rem !important; } .mb-6 { margin-bottom: 1rem !important; } .mb-4 { margin-bottom: 0.75rem !important; } .space-y-4 > * + * { margin-top: 0.625rem !important; }",
  comfortable:
    ".gap-6 { gap: 2rem !important; } .gap-4 { gap: 1.5rem !important; } .p-6 { padding: 2rem !important; } .p-4 { padding: 1.5rem !important; } .mb-6 { margin-bottom: 2rem !important; } .mb-4 { margin-bottom: 1.5rem !important; }",
};

export type CustomizeConfig = Pick<BetterIntraConfig, (typeof CUSTOMIZE_KEYS)[number]>;

const STYLE_ID = "better-intra-customize";
const CSS_ID = "better-intra-custom-css";
/** Look published by the profile being visited (see applyVisitorLook). */
export const VISITOR_STYLE_ID = "better-intra-visitor-look";

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

export const RADIUS: Record<string, string> = {
  default: "",
  none: "0px",
  small: "0.375rem",
  large: "1rem",
  full: "1.5rem",
};

const TRANSPARENT_SURFACES = PAGE_SURFACES.split(", ")
  .filter((s) => s !== "html")
  .map((s) => `html.dark ${s}, html:not(.dark) ${s}`)
  .join(", ");

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
      // Two-colour accent: buttons, progress fills and other solid accent
      // surfaces get a gradient (translucent "bg-primary/20" variants are
      // left alone so they stay see-through).
      const hex2 = c.CUSTOM_ACCENT_GRADIENT ? hexToHslTriplet(c.CUSTOM_ACCENT_COLOR_2) : null;
      if (hex2) {
        rules.push(
          `.bg-primary, .btn-primary, progress::-webkit-progress-value { background-image: linear-gradient(135deg, ${c.CUSTOM_ACCENT_COLOR}, ${c.CUSTOM_ACCENT_COLOR_2}) !important; }`,
        );
      }
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

  const density = DENSITY[c.CUSTOM_DENSITY] ?? "";
  if (density) rules.push(density);

  if (c.CUSTOM_HIDE_FOOTER) {
    rules.push(`footer { display: none !important; }`);
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
      `${TRANSPARENT_SURFACES} { background-color: transparent !important; background-image: none !important; }`,
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
      `${TRANSPARENT_SURFACES} { background-color: transparent !important; background-image: none !important; }`,
    );
    if (cardOpacity === 100) {
      rules.push(
        `html.dark ${CARD_SURFACES.split(", ").join(", html.dark ")} { background-color: hsl(var(--card) / 0.92) !important; }`,
      );
    }
    if (c.CUSTOM_BG_ANIMATE) {
      // Slow drift of the gradient; off for people who asked their OS for
      // less motion.
      rules.push(
        `@keyframes bi-bg-drift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }`,
      );
      rules.push(
        `html, html.dark, html:not(.dark) { background-size: 200% 200% !important; animation: bi-bg-drift 45s ease-in-out infinite; }`,
      );
      rules.push(
        `@media (prefers-reduced-motion: reduce) { html { animation: none !important; } }`,
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

/** Every Customize setting at its default value. */
export function defaultCustomization(): CustomizeConfig {
  const out = {} as Record<string, unknown>;
  for (const key of CUSTOMIZE_KEYS) out[key] = CONFIG_DEFAULT[key];
  return out as CustomizeConfig;
}

/** Stylesheet for a partial look (missing keys at their defaults). */
export function buildLookCss(look: Partial<CustomizeConfig>): string {
  return buildCustomizeCss({ ...defaultCustomization(), ...look });
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

let visitorLook: Partial<CustomizeConfig> | null = null;
let visitorLookKey = "";

/**
 * Apply (or clear, with null) the look published by the profile being
 * visited. It is rendered after the viewer's own customisation so that it
 * wins on the shared declarations, but the viewer's custom CSS stays last.
 * Honours the viewer's CUSTOM_SHOW_OTHERS_LOOK setting.
 */
export async function applyVisitorLook(look: Partial<CustomizeConfig> | null): Promise<void> {
  visitorLook = look && Object.keys(look).length > 0 ? look : null;
  if (!visitorLook) {
    visitorLookKey = "";
    setStyle(VISITOR_STYLE_ID, "");
    return;
  }
  // Called on every mutation pass of the profile page: skip the storage
  // round-trip when the same look is already on screen.
  const key = JSON.stringify(visitorLook);
  if (key === visitorLookKey && document.getElementById(VISITOR_STYLE_ID)) return;
  visitorLookKey = key;
  const { CUSTOM_SHOW_OTHERS_LOOK } = await getConfigMany(["CUSTOM_SHOW_OTHERS_LOOK"]);
  if (CUSTOM_SHOW_OTHERS_LOOK === false) {
    visitorLookKey = "";
    setStyle(VISITOR_STYLE_ID, "");
    return;
  }
  setStyle(VISITOR_STYLE_ID, buildLookCss(visitorLook));
  const own = document.getElementById(CSS_ID);
  if (own && own.nextElementSibling) own.parentElement?.appendChild(own);
}

/** True while a visitor look is displayed. */
export function hasVisitorLook(): boolean {
  return !!document.getElementById(VISITOR_STYLE_ID);
}

let initialised = false;

export async function initCustomize(): Promise<void> {
  await applyCustomizations();
  if (initialised) return;
  initialised = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (CUSTOMIZE_KEYS.some((k) => k in changes)) void applyCustomizations();
    if ("CUSTOM_SHOW_OTHERS_LOOK" in changes) {
      visitorLookKey = "";
      void applyVisitorLook(visitorLook);
    }
  });
}
