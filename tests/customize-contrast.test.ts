/**
 * Customize > Accent colour: the text drawn on the accent (--primary-foreground)
 * must be whichever of black and white reads better, by the WCAG contrast
 * ratio. A luminance cut-off at 0.4 used to give white text to every accent
 * between ~0.18 and 0.4, the default 42 teal included (2.4:1).
 */
import { describe, it, expect } from "vitest";
import {
  CUSTOMIZE_KEYS,
  applyCustomizations,
  buildCustomizeCss,
  buildLookCss,
  contrastForeground,
  relativeLuminance,
  type CustomizeConfig,
} from "../src/features/customize/customize";
import { CONFIG_DEFAULT } from "../src/core/config";

const BLACK = "0 0% 0%";
const WHITE = "0 0% 100%";

const base = Object.fromEntries(
  CUSTOMIZE_KEYS.map((k) => [k, CONFIG_DEFAULT[k]]),
) as CustomizeConfig;

/** WCAG ratio, written out independently of the module. */
function ratio(hex: string, text: "black" | "white"): number {
  const L = relativeLuminance(hex)!;
  return text === "black" ? (L + 0.05) / 0.05 : 1.05 / (L + 0.05);
}

function foregroundOf(css: string): string | undefined {
  return /--primary-foreground: ([^!;]+?) !important/.exec(css)?.[1];
}

describe("contrastForeground picks by contrast ratio", () => {
  it("gives the 42 teal black text (8.7:1), not white (2.4:1)", () => {
    expect(ratio("#00babc", "white")).toBeLessThan(3);
    expect(ratio("#00babc", "black")).toBeGreaterThan(8);
    expect(contrastForeground("#00babc")).toBe(BLACK);
  });

  it("always returns the colour with the higher ratio", () => {
    const samples = [
      "#00babc", "#ff0000", "#e91e63", "#2196f3", "#808080", "#7c3aed",
      "#ffff00", "#1a1a2e", "#00ff41", "#000000", "#ffffff", "#3f51b5",
    ];
    for (const hex of samples) {
      const best = ratio(hex, "black") > ratio(hex, "white") ? BLACK : WHITE;
      expect(contrastForeground(hex), hex).toBe(best);
    }
  });

  it("switches where both ratios meet, at a luminance of about 0.179", () => {
    // #767676 (L 0.181) is just past it, #757575 (L 0.178) just before.
    expect(relativeLuminance("#767676")!).toBeGreaterThan(0.179);
    expect(relativeLuminance("#757575")!).toBeLessThan(0.179);
    expect(contrastForeground("#767676")).toBe(BLACK);
    expect(contrastForeground("#757575")).toBe(WHITE);
  });

  it("keeps white for anything that is not #rrggbb", () => {
    expect(contrastForeground("teal")).toBe(WHITE);
    expect(contrastForeground("#fff")).toBe(WHITE);
    expect(relativeLuminance("nope")).toBeNull();
  });

  it("with two stops, maximises the worse of the two ratios", () => {
    // Yellow alone wants black, dark navy alone wants white. Across both,
    // black's worst ratio is 1.23 (on the navy) and white's 1.07 (on the
    // yellow): black is the less bad of the two.
    expect(contrastForeground("#ffff00", "#1a1a2e")).toBe(BLACK);
    // Teal alone wants black; next to a deep purple (#4c1d95) black's worst
    // falls to 1.9 and white's is 2.4, so white it is.
    expect(contrastForeground("#00babc", "#4c1d95")).toBe(WHITE);
    // An invalid second stop is ignored.
    expect(contrastForeground("#00babc", "red")).toBe(BLACK);
  });
});

describe("the accent stylesheet", () => {
  const accent = (extra: Partial<CustomizeConfig>) =>
    buildCustomizeCss({ ...base, CUSTOM_ACCENT_ENABLED: true, ...extra });

  it("uses the better text colour for the default accent", () => {
    expect(foregroundOf(accent({ CUSTOM_ACCENT_COLOR: "#00babc" }))).toBe(BLACK);
    expect(foregroundOf(accent({ CUSTOM_ACCENT_COLOR: "#1a1a2e" }))).toBe(WHITE);
  });

  it("takes the second stop into account only when the gradient is on", () => {
    const two = { CUSTOM_ACCENT_COLOR: "#00babc", CUSTOM_ACCENT_COLOR_2: "#4c1d95" };
    expect(foregroundOf(accent({ ...two, CUSTOM_ACCENT_GRADIENT: true }))).toBe(WHITE);
    expect(foregroundOf(accent({ ...two, CUSTOM_ACCENT_GRADIENT: false }))).toBe(BLACK);
  });

  it("applies the same rule to a visited profile's look", () => {
    expect(
      foregroundOf(buildLookCss({ CUSTOM_ACCENT_ENABLED: true, CUSTOM_ACCENT_COLOR: "#00babc" })),
    ).toBe(BLACK);
  });
});

describe("the animated page gradient and Disable animations", () => {
  const animated = { ...base, CUSTOM_PAGE_BG_PRESET: "lava", CUSTOM_BG_ANIMATE: true };

  it("drifts by default, with a reduced-motion guard", () => {
    const css = buildCustomizeCss(animated);
    expect(css).toContain("animation: bi-bg-drift");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("does not drift at all when the viewer switched animations off", () => {
    const css = buildCustomizeCss(animated, { disableAnimations: true });
    expect(css).not.toContain("bi-bg-drift");
    // The gradient itself stays: only the motion goes.
    expect(css).toContain("linear-gradient(160deg, #1a0000");
    expect(
      buildLookCss({ CUSTOM_PAGE_BG_PRESET: "lava", CUSTOM_BG_ANIMATE: true }, { disableAnimations: true }),
    ).not.toContain("bi-bg-drift");
  });
});

describe("applyCustomizations", () => {
  it("reads the viewer's Disable animations switch with the look", async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      CUSTOM_PAGE_BG_PRESET: "lava",
      CUSTOM_BG_ANIMATE: true,
    });
    await applyCustomizations();
    const style = () => document.getElementById("better-intra-customize")?.textContent ?? "";
    expect(style()).toContain("bi-bg-drift");

    await chrome.storage.local.set({ DISABLE_ANIMATIONS: true });
    await applyCustomizations();
    expect(style()).not.toContain("bi-bg-drift");
    expect(style()).toContain("#1a0000");
    await chrome.storage.local.clear();
  });
});
