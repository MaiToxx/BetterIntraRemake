import { describe, it, expect } from "vitest";
import {
  CUSTOMIZE_KEYS,
  buildCustomizeCss,
  clampFontScale,
  contrastForeground,
  hexToHslTriplet,
  sanitizeFontFamily,
  shiftLightness,
  type CustomizeConfig,
} from "../src/features/customize/customize";
import { CONFIG_DEFAULT } from "../src/config";

const base = Object.fromEntries(
  CUSTOMIZE_KEYS.map((k) => [k, CONFIG_DEFAULT[k]]),
) as CustomizeConfig;

describe("hexToHslTriplet", () => {
  it("converts known colours", () => {
    expect(hexToHslTriplet("#ffffff")).toBe("0 0% 100%");
    expect(hexToHslTriplet("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriplet("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslTriplet("#00babc")).toBe("181 100% 37%");
  });
  it("rejects anything but 6-digit hex", () => {
    expect(hexToHslTriplet("red")).toBeNull();
    expect(hexToHslTriplet("#fff")).toBeNull();
    expect(hexToHslTriplet("#fff; } body { display:none")).toBeNull();
  });
});

describe("contrastForeground", () => {
  it("picks black on light and white on dark accents", () => {
    expect(contrastForeground("#ffff00")).toBe("0 0% 0%");
    expect(contrastForeground("#1a1a2e")).toBe("0 0% 100%");
  });
});

describe("sanitizeFontFamily / clampFontScale", () => {
  it("strips characters that could end the declaration", () => {
    expect(sanitizeFontFamily("Inter; } body { display:none")).toBe(
      "Inter  body  display:none",
    );
    expect(sanitizeFontFamily("'Fira Code', monospace")).toBe(
      "'Fira Code', monospace",
    );
    expect(sanitizeFontFamily(42)).toBe("");
  });
  it("keeps the scale within 70-140", () => {
    expect(clampFontScale(100)).toBe(100);
    expect(clampFontScale(500)).toBe(140);
    expect(clampFontScale(10)).toBe(70);
    expect(clampFontScale("abc")).toBe(100);
  });
});

describe("buildCustomizeCss", () => {
  it("is empty with the default settings", () => {
    expect(buildCustomizeCss(base)).toBe("");
  });

  it("overrides the primary colour when the custom accent is enabled", () => {
    const css = buildCustomizeCss({
      ...base,
      CUSTOM_ACCENT_ENABLED: true,
      CUSTOM_ACCENT_COLOR: "#ff0000",
    });
    expect(css).toContain("--primary: 0 100% 50% !important");
    expect(css).toContain("--primary-foreground: 0 0% 100%");
    expect(css).toContain("--theme-color: #ff0000");
  });

  it("applies a font preset, a custom family, a scale and a radius", () => {
    expect(buildCustomizeCss({ ...base, CUSTOM_FONT: "mono" })).toContain(
      "font-family: 'JetBrains Mono'",
    );
    expect(
      buildCustomizeCss({
        ...base,
        CUSTOM_FONT: "custom",
        CUSTOM_FONT_FAMILY: "Comic Sans MS",
      }),
    ).toContain("font-family: Comic Sans MS !important");
    expect(buildCustomizeCss({ ...base, CUSTOM_FONT_SCALE: 90 })).toContain(
      "font-size: 90% !important",
    );
    expect(buildCustomizeCss({ ...base, CUSTOM_RADIUS: "none" })).toContain(
      "--radius: 0px",
    );
  });

  it("builds a full palette from page, card and text colours", () => {
    const css = buildCustomizeCss({
      ...base,
      CUSTOM_THEME_ENABLED: true,
      CUSTOM_THEME_BG: "#1c2130",
      CUSTOM_THEME_CARD: "#151a24",
      CUSTOM_THEME_TEXT: "#e2e8f0",
    });
    expect(css).toContain("--background: 225 26% 15% !important");
    expect(css).toContain("--card: 220 26% 11% !important");
    expect(css).toContain("--foreground: 214 32% 91% !important");
    // derived tones exist and differ from their base
    expect(css).toMatch(/--muted: 225 26% 21% !important/);
    expect(css).toMatch(/--border: 220 26% 20% !important/);
    // an invalid colour disables the whole palette rather than emitting junk
    expect(
      buildCustomizeCss({ ...base, CUSTOM_THEME_ENABLED: true, CUSTOM_THEME_BG: "nope" }),
    ).not.toContain("--background");
  });

  it("applies a page background with dim overlay and transparent surfaces", () => {
    const css = buildCustomizeCss({
      ...base,
      CUSTOM_PAGE_BG_URL: "https://img.example.com/wall.jpg",
      CUSTOM_PAGE_BG_DIM: 55,
      CUSTOM_CARD_OPACITY: 80,
    });
    expect(css).toContain('url("https://img.example.com/wall.jpg") center / cover fixed');
    expect(css).toContain("rgba(0,0,0,0.55)");
    expect(css).toContain("background-color: transparent !important");
    expect(css).toContain("hsl(var(--card) / 0.80)");
    // a non-http URL is dropped entirely
    expect(buildCustomizeCss({ ...base, CUSTOM_PAGE_BG_URL: "javascript:x" })).toBe("");
  });

  it("changes the avatar shape only when asked", () => {
    expect(buildCustomizeCss({ ...base, CUSTOM_AVATAR_SHAPE: "square" })).toContain(
      "border-radius: 0 !important",
    );
    expect(buildCustomizeCss({ ...base, CUSTOM_AVATAR_SHAPE: "circle" })).toBe("");
  });

  it("shiftLightness clamps within 0-100", () => {
    expect(shiftLightness("200 10% 95%", 10)).toBe("200 10% 100%");
    expect(shiftLightness("200 10% 3%", -10)).toBe("200 10% 0%");
    expect(shiftLightness("garbage", 5)).toBe("garbage");
  });

  it("ignores an invalid accent colour instead of emitting broken CSS", () => {
    expect(
      buildCustomizeCss({
        ...base,
        CUSTOM_ACCENT_ENABLED: true,
        CUSTOM_ACCENT_COLOR: "not-a-colour",
      }),
    ).toBe("");
  });
});
