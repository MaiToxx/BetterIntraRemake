/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/users/bob" }
 *
 * Theme presets (1.14.0): one palette file generates the page variables, the
 * widgets' daisyUI themes and the hub list; the page follows a preset's own
 * mode; a visited profile's published theme is shown during the visit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { buildThemes, contrast, FILES, FLOORS } from "../scripts/generate-themes.mjs";
import { PALETTES } from "../scripts/themes/palettes.mjs";

const read = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

beforeEach(async () => {
  vi.resetModules();
  // the theme manager listens to storage and to the OS colour scheme
  (globalThis as any).chrome.storage.onChanged ??= { addListener: vi.fn(), removeListener: vi.fn() };
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }) as any;
  await chrome.storage.local.clear();
  sessionStorage.clear();
  document.documentElement.className = "";
  document.head.replaceChildren();
});

describe("generated theme files", () => {
  it("are what the palettes produce (run npm run generate:themes after editing them)", () => {
    const out = buildThemes({
      themesJson: JSON.parse(read(FILES.themesJson)),
      styleCss: read(FILES.styleCss),
    });
    expect(out.problems).toEqual([]);
    expect(read(FILES.themesJson)).toBe(out.themesText);
    expect(read(FILES.styleCss)).toBe(out.styleCss);
    expect(read(FILES.optionsTs)).toBe(out.optionsTs);
    expect(read(FILES.idsTs)).toBe(out.idsTs);
  });

  it.each(PALETTES.map((p) => [p.id, p] as const))("%s is readable", (_id, p) => {
    expect(contrast(p.content, p.base100)).toBeGreaterThanOrEqual(FLOORS.content);
    expect(contrast(p.muted, p.base100)).toBeGreaterThanOrEqual(FLOORS.muted);
    expect(contrast(p.muted, p.base200)).toBeGreaterThanOrEqual(FLOORS.muted);
    if (p.primaryContent) {
      expect(contrast(p.primaryContent, p.primary)).toBeGreaterThanOrEqual(FLOORS.onPrimary);
    }
  });

  it("tints the surfaces: every new palette carries a hue beyond grey", () => {
    const chroma = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    for (const p of PALETTES) {
      // Gruvbox keeps its famous neutral background: its cards and borders are warm
      const most = Math.max(...[p.base100, p.base200, p.surface, p.border].map(chroma));
      expect(most, p.id).toBeGreaterThan(3);
    }
  });
});

describe("the page follows a preset's own mode", () => {
  it("a light preset makes the page light even when the stored mode is dark", async () => {
    await chrome.storage.local.set({ BETTER_INTRA_THEME: "dark", PROFILE_THEME_PRESET: "sakura" });
    const tm = await import("../src/core/theme/theme-manager.ts");
    expect(await tm.getEffectiveTheme()).toBe("light");
    await tm.initThemeManager();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await vi.waitFor(() =>
      expect(document.getElementById("better-intra-theme-preset")?.textContent).toContain(
        "--background: 342 71% 97%",
      ),
    );
  });

  it("the plain dark and light presets still follow the stored mode", async () => {
    await chrome.storage.local.set({ BETTER_INTRA_THEME: "light", PROFILE_THEME_PRESET: "dark" });
    const tm = await import("../src/core/theme/theme-manager.ts");
    expect(await tm.getEffectiveTheme()).toBe("light");
    expect(tm.presetMode("dark")).toBeNull();
    expect(tm.presetMode("catppuccin")).toBe("dark");
    expect(tm.presetMode("nope")).toBeNull();
  });
});

describe("a visited profile's theme", () => {
  it("is shown for the visit, in its mode, and never remembered", async () => {
    await chrome.storage.local.set({ BETTER_INTRA_THEME: "light", PROFILE_THEME_PRESET: "light" });
    const tm = await import("../src/core/theme/theme-manager.ts");
    await tm.initThemeManager();
    expect(sessionStorage.getItem("intra-theme")).toBe("light");
    const seen: unknown[] = [];
    tm.onThemeChange((c) => seen.push(c));

    await tm.setVisitorPreset("catppuccin");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await vi.waitFor(() =>
      expect(document.getElementById("better-intra-theme-preset")?.textContent).toContain(
        "--background: 240 21% 15%",
      ),
    );
    expect(seen).toEqual([{ theme: "dark", preset: "catppuccin" }]);
    // the next page must not open in the visited student's mode
    expect(sessionStorage.getItem("intra-theme")).toBe("light");

    await tm.setVisitorPreset(null);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(seen[1]).toEqual({ theme: "light", preset: "light" });
  });

  it("ignores the default presets and unknown keys", async () => {
    await chrome.storage.local.set({ BETTER_INTRA_THEME: "light" });
    const tm = await import("../src/core/theme/theme-manager.ts");
    await tm.initThemeManager();
    const cb = vi.fn();
    tm.onThemeChange(cb);
    await tm.setVisitorPreset("dark");
    await tm.setVisitorPreset("<script>");
    expect(cb).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("the theme in looks, presets and codes", () => {
  it("the public look carries a known preset, nothing else", async () => {
    const { sanitizePublicLook } = await import("../src/features/customize/public-look.ts");
    expect(sanitizePublicLook({ PROFILE_THEME_PRESET: "gruvbox" })).toEqual({ PROFILE_THEME_PRESET: "gruvbox" });
    expect(sanitizePublicLook({ PROFILE_THEME_PRESET: "evil; }" })).toBeNull();
    // the default says nothing: not a visible look
    expect(sanitizePublicLook({ PROFILE_THEME_PRESET: "dark" })).toBeNull();
  });

  it("a theme code sets the preset; Reset keeps it", async () => {
    const presets = await import("../src/features/customize/presets.ts");
    const code = presets.encodePresetCode(
      presets.sanitizeCustomization({ PROFILE_THEME_PRESET: "kanagawa" }),
    );
    expect(presets.decodePresetCode(code)?.PROFILE_THEME_PRESET).toBe("kanagawa");
    expect(presets.sanitizeCustomization({ PROFILE_THEME_PRESET: "made-up" }).PROFILE_THEME_PRESET).toBe("dark");

    await chrome.storage.local.set({ PROFILE_THEME_PRESET: "kanagawa", CUSTOM_ACCENT_ENABLED: true });
    await presets.resetCustomization();
    const after = await chrome.storage.local.get(["PROFILE_THEME_PRESET", "CUSTOM_ACCENT_ENABLED"]);
    expect(after.PROFILE_THEME_PRESET).toBe("kanagawa");
    expect(after.CUSTOM_ACCENT_ENABLED).toBe(false);
  });
});

describe("publishing the look by default", () => {
  it("pushes once for an account that never chose, and never again", async () => {
    const sync = vi.fn(async () => true);
    vi.doMock("../src/features/account/account.ts", () => ({ syncToCloud: sync }));
    vi.useFakeTimers();
    try {
      await chrome.storage.local.set({ CLOUD_TOKEN: "sess", LAST_CLOUD_SYNC: 1 });
      const { publishDefaultLookOnce } = await import("../src/features/customize/publish.ts");
      await publishDefaultLookOnce();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sync).toHaveBeenCalledTimes(1);
      await publishDefaultLookOnce();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.doUnmock("../src/features/account/account.ts");
    }
  });

  it("never on a fresh install or while the restore question is open: that pushed defaults over the backup", async () => {
    const sync = vi.fn(async () => true);
    vi.doMock("../src/features/account/account.ts", () => ({ syncToCloud: sync }));
    vi.useFakeTimers();
    try {
      const { publishDefaultLookOnce } = await import("../src/features/customize/publish.ts");
      // just signed in on a new install: a session, never pushed, restore pending
      await chrome.storage.local.set({ CLOUD_TOKEN: "sess", PENDING_SETTINGS_RESTORE: true });
      await publishDefaultLookOnce();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sync).not.toHaveBeenCalled();
      // and not later either, once the question is answered
      await chrome.storage.local.remove("PENDING_SETTINGS_RESTORE");
      await chrome.storage.local.set({ LAST_CLOUD_SYNC: 1 });
      await publishDefaultLookOnce();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.doUnmock("../src/features/account/account.ts");
    }
  });

  it("leaves a choice alone, and does nothing signed out", async () => {
    const sync = vi.fn(async () => true);
    vi.doMock("../src/features/account/account.ts", () => ({ syncToCloud: sync }));
    vi.useFakeTimers();
    try {
      const { publishDefaultLookOnce } = await import("../src/features/customize/publish.ts");
      await publishDefaultLookOnce();
      await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CUSTOM_SHARE_LOOK: false });
      await publishDefaultLookOnce();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(sync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.doUnmock("../src/features/account/account.ts");
    }
  });
});
