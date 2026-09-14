import { describe, it, expect } from "vitest";
import {
  PUBLIC_LOOK_KEYS,
  pickPublicLook,
  sanitizePublicLook,
} from "../src/features/customize/public-look";
import {
  buildLookCss,
  CUSTOMIZE_KEYS,
  defaultCustomization,
} from "../src/features/customize/customize";
import { sanitizeVisualUrls } from "../src/features/profile/visuals-sanitize";
import { CONFIG_DEFAULT } from "../src/config";

describe("sanitizePublicLook", () => {
  it("keeps validated presentation values only", () => {
    const look = sanitizePublicLook({
      CUSTOM_ACCENT_ENABLED: true,
      CUSTOM_ACCENT_COLOR: "#ff0000",
      CUSTOM_PAGE_BG_PRESET: "ocean",
      CUSTOM_CARD_STYLE: "glass",
      CUSTOM_PAGE_BG_DIM: "55",
      CUSTOM_CARD_OPACITY: 5,
      // never shared, whatever the server sends
      CUSTOM_CSS: "body { display: none }",
      CUSTOM_FONT: "mono",
      CUSTOM_FONT_SCALE: 130,
      CUSTOM_SCROLLBAR: "hidden",
      // invalid values are dropped
      CUSTOM_THEME_BG: "red; } * { display: none",
      CUSTOM_AVATAR_SHAPE: "hexagon",
      CUSTOM_PAGE_BG_URL: "javascript:alert(1)",
      CUSTOM_RADIUS: 42,
    });
    expect(look).toEqual({
      CUSTOM_ACCENT_ENABLED: true,
      CUSTOM_ACCENT_COLOR: "#ff0000",
      CUSTOM_PAGE_BG_PRESET: "ocean",
      CUSTOM_CARD_STYLE: "glass",
      CUSTOM_PAGE_BG_DIM: 55,
      CUSTOM_CARD_OPACITY: 30,
      CUSTOM_PAGE_BG_URL: "",
    });
  });

  it("returns null when nothing visible remains", () => {
    expect(sanitizePublicLook(null)).toBeNull();
    expect(sanitizePublicLook("x")).toBeNull();
    expect(sanitizePublicLook([])).toBeNull();
    expect(sanitizePublicLook({})).toBeNull();
    expect(sanitizePublicLook({ CUSTOM_CSS: "x", CUSTOM_FONT: "mono" })).toBeNull();
    // every value equal to its default: nothing to show
    expect(
      sanitizePublicLook({ CUSTOM_ACCENT_ENABLED: false, CUSTOM_PAGE_BG_PRESET: "none" }),
    ).toBeNull();
  });

  it("only shares a subset of the customize keys", () => {
    for (const key of PUBLIC_LOOK_KEYS) expect(CUSTOMIZE_KEYS).toContain(key);
    for (const never of ["CUSTOM_CSS", "CUSTOM_FONT", "CUSTOM_FONT_FAMILY", "CUSTOM_FONT_SCALE", "CUSTOM_SCROLLBAR", "CUSTOM_DENSITY", "CUSTOM_HIDE_FOOTER"]) {
      expect(PUBLIC_LOOK_KEYS).not.toContain(never);
    }
  });

  it("pickPublicLook keeps the publishable subset of a full config", () => {
    const picked = pickPublicLook({ ...defaultCustomization(), CUSTOM_CSS: "x", CUSTOM_ACCENT_COLOR: "#123456" });
    expect("CUSTOM_CSS" in picked).toBe(false);
    expect(picked.CUSTOM_ACCENT_COLOR).toBe("#123456");
    expect(Object.keys(picked).sort()).toEqual([...PUBLIC_LOOK_KEYS].sort());
  });
});

describe("buildLookCss", () => {
  it("renders a partial look over the defaults", () => {
    const css = buildLookCss({ CUSTOM_ACCENT_ENABLED: true, CUSTOM_ACCENT_COLOR: "#ff0000" });
    expect(css).toContain("--primary: 0 100% 50%");
    expect(css).not.toContain("font-family");
    expect(buildLookCss({})).toBe("");
  });
});

describe("sanitizeVisualUrls with a look", () => {
  it("carries a validated look and drops empty ones", () => {
    const base = { avatar: "", banner: "", bannerMode: "fill", background: "", backgroundMode: "fill" };
    expect(sanitizeVisualUrls({ ...base, look: { CUSTOM_PAGE_BG_PRESET: "lava" } }).look).toEqual({
      CUSTOM_PAGE_BG_PRESET: "lava",
    });
    expect(sanitizeVisualUrls({ ...base, look: { CUSTOM_CSS: "x" } }).look).toBeNull();
    expect(sanitizeVisualUrls({ ...base }).look).toBeNull();
  });
});

describe("share flags", () => {
  it("default to private, and to showing other people's looks", () => {
    expect(CONFIG_DEFAULT.CUSTOM_SHARE_LOOK).toBe(false);
    expect(CONFIG_DEFAULT.CUSTOM_SHOW_OTHERS_LOOK).toBe(true);
  });
});
