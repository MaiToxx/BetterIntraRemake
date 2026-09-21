import { describe, it, expect, beforeEach } from "vitest";
import {
  CODE_PREFIX,
  decodePresetCode,
  deletePreset,
  encodePresetCode,
  listPresets,
  sanitizeCustomization,
  savePreset,
} from "../src/features/customize/presets";
import { CUSTOMIZE_KEYS, buildCustomizeCss } from "../src/features/customize/customize";
import { CONFIG_DEFAULT } from "../src/core/config";

const defaults = () =>
  Object.fromEntries(CUSTOMIZE_KEYS.map((k) => [k, CONFIG_DEFAULT[k]])) as ReturnType<
    typeof sanitizeCustomization
  >;

beforeEach(() => {
  (chrome.storage.local.clear as any)();
});

describe("sanitizeCustomization", () => {
  it("keeps typed known keys and replaces the rest with defaults", () => {
    const out = sanitizeCustomization({
      CUSTOM_ACCENT_ENABLED: true,
      CUSTOM_ACCENT_COLOR: "#ff0000",
      CUSTOM_FONT_SCALE: "big", // wrong type
      NOT_A_KEY: 1,
    });
    expect(out.CUSTOM_ACCENT_ENABLED).toBe(true);
    expect(out.CUSTOM_ACCENT_COLOR).toBe("#ff0000");
    expect(out.CUSTOM_FONT_SCALE).toBe(CONFIG_DEFAULT.CUSTOM_FONT_SCALE);
    expect("NOT_A_KEY" in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual([...CUSTOMIZE_KEYS].sort());
  });
});

describe("theme codes", () => {
  it("round-trips and only encodes differences from the defaults", () => {
    const values = { ...defaults(), CUSTOM_ACCENT_ENABLED: true, CUSTOM_ACCENT_COLOR: "#123456", CUSTOM_FONT: "mono" as const };
    const code = encodePresetCode(values);
    expect(code.startsWith(CODE_PREFIX)).toBe(true);
    expect(code.length).toBeLessThan(200);
    expect(decodePresetCode(code)).toEqual(values);
    expect(decodePresetCode(encodePresetCode(defaults()))).toEqual(defaults());
  });

  it("rejects garbage and foreign codes", () => {
    expect(decodePresetCode("hello")).toBeNull();
    expect(decodePresetCode(CODE_PREFIX + "!!!")).toBeNull();
    expect(decodePresetCode(CODE_PREFIX + btoa("[1,2]"))).toBeNull();
    expect(decodePresetCode(42)).toBeNull();
  });
});

describe("presets storage", () => {
  it("saves, replaces by name, lists newest first and deletes", async () => {
    await savePreset("Nuit", { ...defaults(), CUSTOM_FONT: "serif" });
    await savePreset("Jour", { ...defaults(), CUSTOM_FONT: "mono" });
    await savePreset("Nuit", { ...defaults(), CUSTOM_FONT: "rounded" });
    const list = await listPresets();
    expect(list.map((p) => p.name)).toEqual(["Nuit", "Jour"]);
    expect(list[0].values.CUSTOM_FONT).toBe("rounded");
    await deletePreset("Jour");
    expect((await listPresets()).map((p) => p.name)).toEqual(["Nuit"]);
  });

  it("refuses an empty name", async () => {
    await expect(savePreset("   ", defaults())).rejects.toThrow();
  });
});

describe("new customize rules", () => {
  it("emits gradient, card style and scrollbar rules", () => {
    const base = defaults();
    expect(buildCustomizeCss({ ...base, CUSTOM_PAGE_BG_PRESET: "ocean" })).toContain("linear-gradient(180deg, #0f2027");
    expect(buildCustomizeCss({ ...base, CUSTOM_CARD_STYLE: "outlined" })).toContain("border: 1px solid hsl(var(--primary) / 0.45)");
    expect(buildCustomizeCss({ ...base, CUSTOM_SCROLLBAR: "accent" })).toContain("scrollbar-color: hsl(var(--primary)) transparent");
    expect(buildCustomizeCss({ ...base, CUSTOM_SCROLLBAR: "hidden" })).toContain("scrollbar-width: none");
    // an image URL takes precedence over the gradient preset
    const css = buildCustomizeCss({ ...base, CUSTOM_PAGE_BG_PRESET: "ocean", CUSTOM_PAGE_BG_URL: "https://x.example/a.jpg" });
    expect(css).toContain("a.jpg");
    expect(css).not.toContain("#0f2027");
  });
});

describe("review fixes", () => {
  it("accepts numbers stored as strings by the hub", () => {
    const out = sanitizeCustomization({ CUSTOM_FONT_SCALE: "110", CUSTOM_PAGE_BG_DIM: "55", CUSTOM_CARD_OPACITY: "abc" });
    expect(out.CUSTOM_FONT_SCALE).toBe(110);
    expect(out.CUSTOM_PAGE_BG_DIM).toBe(55);
    expect(out.CUSTOM_CARD_OPACITY).toBe(CONFIG_DEFAULT.CUSTOM_CARD_OPACITY);
  });

  it("never carries custom CSS in a theme code", () => {
    const values = { ...defaults(), CUSTOM_CSS: "body { display: none }", CUSTOM_FONT: "mono" as const };
    const code = encodePresetCode(values);
    expect(atob(code.slice(CODE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/"))).not.toContain("CUSTOM_CSS");
    expect(decodePresetCode(code)?.CUSTOM_CSS).toBe("");
    // a hand-crafted code smuggling CSS is stripped too
    const forged = CODE_PREFIX + btoa(JSON.stringify({ CUSTOM_CSS: "body { display: none }" })).replace(/=+$/, "");
    expect(decodePresetCode(forged)?.CUSTOM_CSS).toBe("");
  });
});
