/**
 * Style part of the public profile extras: ProfileExtras -> stylesheet text.
 *
 * Pure (no DOM, no storage): extras-apply.ts decides where the text goes and
 * can compare it with what is already on the page, and the whole thing is
 * unit-testable without a profile page.
 *
 * The extras were chosen by ANOTHER user. extras-sanitize.ts already rebuilt
 * every value, but this is the last stop before a <style> element, so nothing
 * here relies on it: the only things taken from `x` and written into the CSS
 * are colours that match a strict #rrggbb and integers clamped to a range.
 * Enums only select between constants written in this file (or looked up,
 * own-property only, in the preset tables of customize.ts).
 *
 * Specificity: profile-card.ts removes and re-appends its own <style> on
 * every pass (so it is always last in the document) with !important rules on
 * the very same elements. Every selector is therefore prefixed with "html "
 * and every declaration is !important: we win on specificity, whatever the
 * order of the stylesheets.
 */
import { BG_PRESETS, FONT_PRESETS } from "../../customize/customize.ts";
import {
  AVATAR_SELECTOR,
  BACKGROUND_SELECTOR,
  BANNER_SELECTOR,
} from "../selectors.ts";
import {
  LEVEL_FILL_SELECTOR,
  LIMITS,
  NAME_SELECTOR,
  PROFILE_CARD,
  type ProfileExtras,
} from "./extras.ts";

export interface ExtrasCssOptions {
  /**
   * The owner also published a background picture for the header backdrop
   * (visuals.ts): the picture wins, the gradient preset is skipped. The dim
   * still applies, it is what makes a busy picture readable.
   */
  hasBackgroundImage?: boolean;
}

const HEX6 = /^#[0-9a-f]{6}$/i;

/**
 * Rainbow colour stops. First and last are identical so that the gradient
 * can slide by one full tile without a visible seam.
 */
const RAINBOW_STOPS =
  "#ff004c, #ff8a00, #ffe600, #2bd96b, #00c2ff, #7a5cff, #ff004c";

/** Width of one tile of the striped level bar (see ft-px-stripes). */
const STRIPE_TILE_PX = 20;

/**
 * ft-px-rainbow: the gradient is 300% wide. A background-position of P%
 * offsets the image by (box - image) * P = -2 * box * P, so 150% is exactly
 * one image width (3 * box): with the default background-repeat the last
 * frame is identical to the first one.
 * ft-px-stripes: slides the pattern by exactly one tile, same idea.
 * ft-px-hue: rotates the hues of the conic ring instead of rotating the
 * element, so nothing moves around the avatar.
 */
const KEYFRAMES = {
  "ft-px-rainbow":
    "@keyframes ft-px-rainbow { from { background-position: 0% 50%; } to { background-position: 150% 50%; } }",
  "ft-px-hue":
    "@keyframes ft-px-hue { from { filter: hue-rotate(0deg); } to { filter: hue-rotate(360deg); } }",
  "ft-px-stripes": `@keyframes ft-px-stripes { from { background-position: 0 0; } to { background-position: ${STRIPE_TILE_PX}px 0; } }`,
} as const;
type KeyframesName = keyof typeof KEYFRAMES;

/** What the rule builders below write into. */
interface Sheet {
  rules: string[];
  /** A Set: a @keyframes shared by two rules (rainbow name + level) is emitted once. */
  keyframes: Set<KeyframesName>;
  /** Selectors carrying an animation, for the reduced-motion block. */
  animated: string[];
}

/** The value itself when it is a strict #rrggbb, "" otherwise. */
function hex(value: unknown): string {
  return typeof value === "string" && HEX6.test(value) ? value : "";
}

/** Integer within [min, max]; anything that is not a finite number is `min`. */
function clampInt(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Own-property lookup: "constructor" or "__proto__" never resolve to anything. */
function preset(table: Record<string, string>, key: unknown): string {
  if (typeof key !== "string") return "";
  if (!Object.prototype.hasOwnProperty.call(table, key)) return "";
  const value = table[key];
  return typeof value === "string" ? value : "";
}

/**
 * "html " in front of every part of a selector list, plus an optional
 * pseudo-element. Split on commas so that the day selectors.ts lists two
 * alternatives, the second one does not silently lose the prefix.
 */
function scope(selector: string, suffix = ""): string {
  return selector
    .split(",")
    .map((part) => `html ${part.trim()}${suffix}`)
    .join(", ");
}

/** One rule, every declaration !important (see the file comment). */
function rule(selector: string, declarations: string[]): string {
  return `${selector} { ${declarations.map((d) => `${d} !important;`).join(" ")} }`;
}

function animate(sheet: Sheet, selector: string, name: KeyframesName): void {
  sheet.keyframes.add(name);
  sheet.animated.push(selector);
}

/**
 * Paint a background through the glyphs only. `color: transparent` is for
 * engines that ignore -webkit-text-fill-color; the text-shadow has to go
 * because profile-card.ts sets a dark one that would show through the now
 * transparent text as a grey smear.
 */
function clippedToText(image: string): string[] {
  return [
    `background-image: ${image}`,
    "-webkit-background-clip: text",
    "background-clip: text",
    "-webkit-text-fill-color: transparent",
    "color: transparent",
    "text-shadow: none",
  ];
}

function nameRules(x: ProfileExtras, sheet: Sheet): void {
  const sel = scope(NAME_SELECTOR);
  const c1 = hex(x.nameColor);
  const c2 = hex(x.nameColor2);

  switch (x.nameStyle) {
    case "accent":
      sheet.rules.push(rule(sel, ["color: hsl(var(--primary))"]));
      break;
    case "custom":
      if (c1) sheet.rules.push(rule(sel, [`color: ${c1}`]));
      break;
    case "gradient":
      if (c1 && c2) {
        sheet.rules.push(
          rule(sel, clippedToText(`linear-gradient(90deg, ${c1}, ${c2})`)),
        );
      }
      break;
    case "rainbow":
      sheet.rules.push(
        rule(sel, [
          ...clippedToText(`linear-gradient(90deg, ${RAINBOW_STOPS})`),
          "background-size: 300% 100%",
          "animation: ft-px-rainbow 6s linear infinite",
        ]),
      );
      animate(sheet, sel, "ft-px-rainbow");
      break;
    case "glow":
      if (c1) {
        sheet.rules.push(
          rule(sel, [
            `color: ${c1}`,
            `text-shadow: 0 0 8px ${c1}, 0 0 20px ${c1}`,
          ]),
        );
      }
      break;
    case "neon":
      // a neon tube is almost white, the colour is in the halo around it
      if (c1 && c2) {
        sheet.rules.push(
          rule(sel, [
            "color: #fffdfa",
            `text-shadow: 0 0 2px #ffffff, 0 0 8px ${c1}, 0 0 18px ${c1}, 0 0 34px ${c2}, 0 0 60px ${c2}`,
          ]),
        );
      }
      break;
    default:
      break;
  }

  // "default" maps to "" in the table, like any unknown key
  if (x.nameFont !== "default") {
    const family = preset(FONT_PRESETS, x.nameFont);
    if (family) sheet.rules.push(rule(sel, [`font-family: ${family}`]));
  }
}

/**
 * A real gradient cannot be a box-shadow, so the ring is a ::before that is
 * 6px larger than the avatar on every side, filled with the gradient, and
 * masked down to its own padding (content-box XOR border-box = the ring).
 * ::after is left alone: visuals.ts uses it for the "Edit" overlay.
 */
function ringRules(sheet: Sheet, background: string, animation?: string): void {
  const sel = scope(AVATAR_SELECTOR);
  const ring = scope(AVATAR_SELECTOR, "::before");
  // the ring lives outside the avatar's box: it needs a positioned parent
  // that does not clip it
  sheet.rules.push(rule(sel, ["position: relative", "overflow: visible"]));
  const declarations = [
    'content: ""',
    "position: absolute",
    "inset: -6px",
    "padding: 6px",
    "border-radius: inherit",
    "pointer-events: none",
    `background: ${background}`,
    "-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    "mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    "-webkit-mask-composite: xor",
    "mask-composite: exclude",
  ];
  if (animation) declarations.push(`animation: ${animation}`);
  sheet.rules.push(rule(ring, declarations));
}

function frameRules(x: ProfileExtras, sheet: Sheet): void {
  const sel = scope(AVATAR_SELECTOR);
  const c1 = hex(x.frameColor);
  const c2 = hex(x.frameColor2);

  // box-shadow (and outline) are painted outside the box without being part
  // of it: no layout shift, and a rounded parent never clips them
  switch (x.frame) {
    case "solid":
      if (c1) sheet.rules.push(rule(sel, [`box-shadow: 0 0 0 4px ${c1}`]));
      break;
    case "double":
      if (c1 && c2) {
        sheet.rules.push(
          rule(sel, [
            `box-shadow: 0 0 0 3px ${c1}, 0 0 0 6px rgba(0,0,0,0.6), 0 0 0 9px ${c2}`,
          ]),
        );
      }
      break;
    case "dashed":
      if (c1) {
        sheet.rules.push(
          rule(sel, [`outline: 3px dashed ${c1}`, "outline-offset: 4px"]),
        );
      }
      break;
    case "glow":
      if (c1) {
        sheet.rules.push(
          rule(sel, [`box-shadow: 0 0 0 3px ${c1}, 0 0 26px 6px ${c1}`]),
        );
      }
      break;
    case "neon":
      if (c1 && c2) {
        sheet.rules.push(
          rule(sel, [
            `box-shadow: 0 0 0 3px ${c1}, 0 0 14px 3px ${c1}, 0 0 36px 10px ${c2}`,
          ]),
        );
      }
      break;
    case "gradient":
      if (c1 && c2) ringRules(sheet, `linear-gradient(135deg, ${c1}, ${c2})`);
      break;
    case "rainbow":
      ringRules(
        sheet,
        `conic-gradient(${RAINBOW_STOPS})`,
        "ft-px-hue 6s linear infinite",
      );
      animate(sheet, scope(AVATAR_SELECTOR, "::before"), "ft-px-hue");
      break;
    default:
      break;
  }
}

function levelRules(x: ProfileExtras, sheet: Sheet): void {
  const sel = scope(LEVEL_FILL_SELECTOR);
  const c1 = hex(x.levelColor);
  const c2 = hex(x.levelColor2);

  switch (x.levelStyle) {
    case "custom":
      // background-image: none, or a two-colour accent (customize.ts paints
      // .bg-primary with a gradient) would hide the colour
      if (c1) {
        sheet.rules.push(
          rule(sel, [`background-color: ${c1}`, "background-image: none"]),
        );
      }
      break;
    case "gradient":
      if (c1 && c2) {
        sheet.rules.push(
          rule(sel, [
            `background-color: ${c1}`,
            `background-image: linear-gradient(90deg, ${c1}, ${c2})`,
          ]),
        );
      }
      break;
    case "rainbow":
      sheet.rules.push(
        rule(sel, [
          `background-image: linear-gradient(90deg, ${RAINBOW_STOPS})`,
          "background-size: 300% 100%",
          "animation: ft-px-rainbow 6s linear infinite",
        ]),
      );
      animate(sheet, sel, "ft-px-rainbow");
      break;
    case "striped":
      // Percentage stops on a square tile: 50% of a 45deg gradient line is
      // exactly one tile width, so the stripes join from tile to tile (pixel
      // stops would not: the period would be an irrational number of pixels).
      if (c1) {
        sheet.rules.push(
          rule(sel, [
            `background-color: ${c1}`,
            "background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.18) 0 25%, transparent 25% 50%)",
            `background-size: ${STRIPE_TILE_PX}px ${STRIPE_TILE_PX}px`,
            "animation: ft-px-stripes 1s linear infinite",
          ]),
        );
        animate(sheet, sel, "ft-px-stripes");
      }
      break;
    default:
      break;
  }
}

function bannerRules(
  x: ProfileExtras,
  sheet: Sheet,
  hasBackgroundImage: boolean,
): void {
  const backdrop = scope(BACKGROUND_SELECTOR);
  const declarations: string[] = [];

  if (!hasBackgroundImage && x.bannerGradient !== "none") {
    // the presets are complete `background` shorthand values
    const gradient = preset(BG_PRESETS, x.bannerGradient);
    if (gradient) declarations.push(`background: ${gradient}`);
  }

  // No pseudo-element for the dim: an inset shadow is painted above the
  // background (picture included) and below the children, which is exactly
  // the layer an overlay would need, without touching the stacking order.
  const dim = clampInt(x.bannerDim, 0, LIMITS.bannerDimMax);
  if (dim > 0) {
    declarations.push(`box-shadow: inset 0 0 0 9999px rgba(0,0,0,${dim / 100})`);
  }
  if (declarations.length) sheet.rules.push(rule(backdrop, declarations));

  const blur = clampInt(x.bannerBlur, 0, LIMITS.bannerBlurMax);
  if (blur > 0) {
    sheet.rules.push(
      rule(scope(BANNER_SELECTOR), [
        `-webkit-backdrop-filter: blur(${blur}px)`,
        `backdrop-filter: blur(${blur}px)`,
      ]),
    );
  }

  // profile-card.ts only lights the card up on hover: make it permanent, in
  // the owner's profile colour when they published one
  if (x.cardGlow === true) {
    sheet.rules.push(
      rule(scope(PROFILE_CARD), [
        "border-color: var(--user-color, hsl(var(--primary)))",
        "box-shadow: 0 0 24px var(--user-color-translucent, rgba(0,186,188,0.25))",
      ]),
    );
  }
}

/**
 * Stylesheet text for the style part of the extras; "" when every value is
 * neutral (the caller then removes its <style> element).
 */
export function buildExtrasCss(
  x: ProfileExtras,
  opts: ExtrasCssOptions = {},
): string {
  if (!x || typeof x !== "object") return "";
  const sheet: Sheet = { rules: [], keyframes: new Set(), animated: [] };

  nameRules(x, sheet);
  frameRules(x, sheet);
  levelRules(x, sheet);
  bannerRules(x, sheet, opts?.hasBackgroundImage === true);

  if (sheet.rules.length === 0) return "";

  const out: string[] = [];
  for (const name of sheet.keyframes) out.push(KEYFRAMES[name]);
  out.push(...sheet.rules);
  if (sheet.animated.length) {
    // last, so that it beats the animations above at equal specificity
    out.push(
      `@media (prefers-reduced-motion: reduce) { ${rule(sheet.animated.join(", "), ["animation: none"])} }`,
    );
  }
  return out.join("\n");
}
