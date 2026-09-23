/**
 * Generates the theme presets from scripts/themes/palettes.mjs (see there).
 *
 *   node scripts/generate-themes.mjs          write themes.json, style.css, theme-options.ts
 *   node scripts/generate-themes.mjs --check  exit 1 if any of them is out of date
 *
 * buildThemes() is pure and exported for tests/themes.test.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTES, RETINTS, LEGACY, GROUPS } from "./themes/palettes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FILES = {
  themesJson: resolve(ROOT, "src/core/theme/themes.json"),
  styleCss: resolve(ROOT, "src/core/styles/style.css"),
  optionsTs: resolve(ROOT, "src/features/hub/settings/theme-options.ts"),
  idsTs: resolve(ROOT, "src/core/theme/theme-ids.ts"),
};

const BEGIN = "/* BEGIN GENERATED THEMES: npm run generate:themes (scripts/themes/palettes.mjs) */";
const END = "/* END GENERATED THEMES */";

/** Contrast floors, WCAG ratios. */
export const FLOORS = { content: 7, muted: 4.5, onPrimary: 4.5 };

// ------------------------------------------------------------ colour maths --

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** "H S% L%" as the Intra's CSS variables want it. */
export function hexToHslVar(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
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
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** "H S% L%" back to #rrggbb (for the accents kept from themes.json). */
function hslVarToHex(v) {
  const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/.exec(v.trim());
  if (!m) throw new Error(`not an "H S% L%" value: ${v}`);
  return hslToHex(+m[1], +m[2], +m[3]);
}

function luminance(hex) {
  const lin = hexToRgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Of the palette's darkest and lightest colours, the one readable on `bg`. */
function contentFor(bg, p) {
  const pool = [p.base100, p.base300, p.content].sort((a, b) => luminance(a) - luminance(b));
  const [dark, light] = [pool[0], pool[pool.length - 1]];
  return contrast(bg, dark) >= contrast(bg, light) ? dark : light;
}

// ------------------------------------------------------------ the ramps ----

function retintPalette(r, primaryHex) {
  const { hue: h, sat: s, mode } = r;
  const ramp =
    mode === "light"
      ? {
          base100: hslToHex(h, s + 10, 97),
          base200: hslToHex(h, s, 94),
          base300: hslToHex(h, s - 4, 89),
          surface: hslToHex(h, s - 2, 91),
          border: hslToHex(h, s - 8, 84),
          content: hslToHex(h, 30, 15),
          muted: hslToHex(h, 14, 36),
        }
      : {
          base100: hslToHex(h, s, 11),
          base200: hslToHex(h, s, 8),
          base300: hslToHex(h, s, 6),
          surface: hslToHex(h, s, 15),
          border: hslToHex(h, s, 18),
          content: hslToHex(h, 12, 86),
          muted: hslToHex(h, 8, 64),
        };
  return { ...ramp, id: r.id, mode, primary: primaryHex };
}

/** The page variables of theme-manager.ts for one palette. */
function pageVars(p) {
  const v = hexToHslVar;
  return {
    background: v(p.base100),
    card: v(p.base200),
    foreground: v(p.content),
    muted: v(p.surface),
    mutedForeground: v(p.muted),
    popover: v(p.base200),
    popoverForeground: v(p.content),
    accent: v(p.surface),
    accentForeground: v(p.content),
    border: v(p.border),
    input: v(p.base200),
  };
}

function daisyBlock(p, full) {
  const lines = [
    "@plugin \"daisyui/theme\" {",
    `  name: "${p.id}";`,
    "  default: false;",
    "  prefersdark: false;",
    `  color-scheme: "${p.mode}";`,
    `  --color-base-100: ${p.base100};`,
    `  --color-base-200: ${p.base200};`,
    `  --color-base-300: ${p.base300};`,
    `  --color-base-content: ${p.content};`,
  ];
  if (full) {
    for (const key of ["primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"]) {
      const color = p[key];
      const on = key === "primary" && p.primaryContent ? p.primaryContent : contentFor(color, p);
      lines.push(`  --color-${key}: ${color};`, `  --color-${key}-content: ${on};`);
    }
    lines.push(
      "  --radius-selector: 0.5rem;",
      "  --radius-field: 0.25rem;",
      "  --radius-box: 0.5rem;",
      "  --size-selector: 0.25rem;",
      "  --size-field: 0.25rem;",
      "  --border: 1px;",
      "  --depth: 1;",
      "  --noise: 0;",
    );
  }
  lines.push("}");
  return lines.join("\n");
}

function checkContrast(p, problems) {
  const c = contrast(p.content, p.base100);
  if (c < FLOORS.content) problems.push(`${p.id}: body text ${c.toFixed(2)}:1 < ${FLOORS.content}`);
  for (const bg of [p.base100, p.base200]) {
    const m = contrast(p.muted, bg);
    if (m < FLOORS.muted) problems.push(`${p.id}: secondary text ${m.toFixed(2)}:1 on ${bg} < ${FLOORS.muted}`);
  }
  if (p.primaryContent) {
    const o = contrast(p.primaryContent, p.primary);
    if (o < FLOORS.onPrimary) problems.push(`${p.id}: text on accent ${o.toFixed(2)}:1 < ${FLOORS.onPrimary}`);
  }
}

// ------------------------------------------------------------ assembly -----

export function buildThemes({ themesJson, styleCss }) {
  const problems = [];
  const themes = structuredClone(themesJson);
  const blocks = [];
  const ids = new Set();

  for (const p of PALETTES) {
    if (ids.has(p.id)) problems.push(`duplicate id ${p.id}`);
    ids.add(p.id);
    if (LEGACY.some((l) => l.id === p.id)) problems.push(`${p.id} is also a LEGACY preset`);
    const primaryContent = p.primaryContent ?? contentFor(p.primary, p);
    const full = { ...p, primaryContent };
    checkContrast(full, problems);
    themes[p.id] = {
      primary: hexToHslVar(p.primary),
      primaryForeground: hexToHslVar(primaryContent),
      ring: hexToHslVar(p.primary),
      [p.mode]: pageVars(full),
    };
    blocks.push(daisyBlock(full, true));
  }

  for (const r of RETINTS) {
    const current = themesJson[r.id];
    if (!current) {
      problems.push(`retint ${r.id}: not in themes.json`);
      continue;
    }
    const p = retintPalette(r, hslVarToHex(current.primary));
    checkContrast(p, problems);
    themes[r.id] = { ...current, [r.mode]: pageVars(p) };
    blocks.push(daisyBlock(p, false));
  }

  for (const l of LEGACY) {
    if (!themes[l.id]) problems.push(`legacy ${l.id}: not in themes.json`);
  }

  // style.css: replace (or append) the generated region
  const region = `${BEGIN}\n\n${blocks.join("\n\n")}\n\n${END}`;
  const at = styleCss.indexOf(BEGIN);
  const endAt = styleCss.indexOf(END);
  const nextCss =
    at >= 0 && endAt > at
      ? styleCss.slice(0, at) + region + styleCss.slice(endAt + END.length)
      : styleCss.replace(/\s*$/, "\n\n") + region + "\n";

  // hub swatches
  const entries = [
    ...LEGACY.map((l) => ({ ...l })),
    ...PALETTES.map((p) => ({ id: p.id, label: p.label, mode: p.mode, group: p.group })),
  ];
  const optionLines = [];
  GROUPS.forEach((group, i) => {
    const inGroup = entries.filter((e) => e.group === group);
    if (!inGroup.length) return;
    if (i > 0) optionLines.push("  { divider: true },");
    optionLines.push(`  { label: ${JSON.stringify(group)} },`);
    for (const e of inGroup) {
      const t = themes[e.id];
      const bg = (t?.[e.mode] ?? t?.dark ?? t?.light)?.background ?? (e.mode === "dark" ? "220 20% 10%" : "0 0% 100%");
      optionLines.push(
        `  { label: ${JSON.stringify(e.label)}, value: ${JSON.stringify(e.id)}, color: ${JSON.stringify(t?.primary ?? "199 89% 48%")}, bg: ${JSON.stringify(bg)}, mode: ${JSON.stringify(e.mode)} },`,
      );
    }
  });
  for (const id of Object.keys(themes)) {
    if (!entries.some((e) => e.id === id)) problems.push(`themes.json has ${id} but the hub does not list it`);
  }
  const optionsTs = [
    "// Generated by scripts/generate-themes.mjs from scripts/themes/palettes.mjs.",
    "// Do not edit: change the palettes and run `npm run generate:themes`.",
    'import type { HubSettingDef } from "../hubSettings.data.ts";',
    "",
    "/** The hub's theme swatches: accent (`color`) over page background (`bg`). */",
    'export const THEME_OPTIONS: NonNullable<HubSettingDef["options"]> = [',
    ...optionLines,
    "];",
    "",
  ].join("\n");

  const idsTs = [
    "// Generated by scripts/generate-themes.mjs. Do not edit.",
    "",
    "/**",
    " * Every preset name, for validators that must not pull the colour table in",
    " * (the public look and theme codes are also bundled in the popup).",
    " */",
    "export const THEME_IDS: ReadonlySet<string> = new Set([",
    ...Object.keys(themes).map((id) => `  ${JSON.stringify(id)},`),
    "]);",
    "",
    "/** The mode each preset has colours for (theme-manager.ts presetMode). */",
    'export const THEME_MODES: Readonly<Record<string, "dark" | "light">> = {',
    ...Object.entries(themes).map(([id, t]) => `  ${JSON.stringify(id)}: ${JSON.stringify(t.dark ? "dark" : "light")},`),
    "};",
    "",
  ].join("\n");
  const themesText = JSON.stringify(themes, null, 2) + "\n";
  return { themesText, styleCss: nextCss, optionsTs, idsTs, problems };
}

// ------------------------------------------------------------ CLI ----------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const themesJson = JSON.parse(read(FILES.themesJson));
  const styleCss = read(FILES.styleCss);
  const readOr = (p) => {
    try {
      return read(p);
    } catch {
      return "";
    }
  };
  const optionsNow = readOr(FILES.optionsTs);
  const idsNow = readOr(FILES.idsTs);
  const out = buildThemes({ themesJson, styleCss });
  if (out.problems.length) {
    console.error("Theme problems:\n  " + out.problems.join("\n  "));
    process.exit(1);
  }
  const targets = [
    [FILES.themesJson, read(FILES.themesJson), out.themesText],
    [FILES.styleCss, styleCss, out.styleCss],
    [FILES.optionsTs, optionsNow, out.optionsTs],
    [FILES.idsTs, idsNow, out.idsTs],
  ];
  const stale = targets.filter(([, now, next]) => now !== next);
  if (check) {
    if (stale.length) {
      console.error("Out of date, run `npm run generate:themes`:\n  " + stale.map(([p]) => p).join("\n  "));
      process.exit(1);
    }
    console.log(`themes ok: ${PALETTES.length} palettes, ${RETINTS.length} retints, ${LEGACY.length} kept`);
  } else {
    for (const [p, , next] of stale) writeFileSync(p, next);
    console.log(`wrote ${stale.length} file(s): ${PALETTES.length} palettes, ${RETINTS.length} retints`);
  }
}
