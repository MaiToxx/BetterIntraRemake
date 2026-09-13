import { describe, it, expect } from "vitest";
import {
  buildCustomizeCss,
  clampFontScale,
  contrastForeground,
  hexToHslTriplet,
  sanitizeFontFamily,
} from "../src/features/customize/customize";
import { CONFIG_DEFAULT } from "../src/config";

const base = {
  CUSTOM_ACCENT_ENABLED: CONFIG_DEFAULT.CUSTOM_ACCENT_ENABLED,
  CUSTOM_ACCENT_COLOR: CONFIG_DEFAULT.CUSTOM_ACCENT_COLOR,
  CUSTOM_FONT: CONFIG_DEFAULT.CUSTOM_FONT,
  CUSTOM_FONT_FAMILY: CONFIG_DEFAULT.CUSTOM_FONT_FAMILY,
  CUSTOM_FONT_SCALE: CONFIG_DEFAULT.CUSTOM_FONT_SCALE,
  CUSTOM_RADIUS: CONFIG_DEFAULT.CUSTOM_RADIUS,
  CUSTOM_CSS: CONFIG_DEFAULT.CUSTOM_CSS,
};

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
