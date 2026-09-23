import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The hub's theme toggle restyles the Intra page live through the theme
// manager; the widgets in shadow roots (hub, logtime, friends, profile card)
// carry their own data-theme and re-read it from the theme manager's event.

type Listener = (changes: Record<string, unknown>, area: string) => void;
let storageListeners: Listener[];

beforeEach(() => {
  vi.resetModules();
  storageListeners = [];
  (globalThis as any).chrome.storage.onChanged = {
    addListener: vi.fn((cb: Listener) => storageListeners.push(cb)),
    removeListener: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
  }) as any;
  sessionStorage.clear();
});

afterEach(async () => {
  delete (globalThis as any).chrome.storage.onChanged;
  await chrome.storage.local.clear();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Write like another context would, then deliver storage.onChanged. */
async function fireStorage(changes: Record<string, { newValue: unknown }>) {
  await chrome.storage.local.set(
    Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])),
  );
  for (const cb of storageListeners) cb(changes, "local");
  await flush();
  await flush();
}

describe("theme manager", () => {
  it("announces the effective theme and preset after BETTER_INTRA_THEME changes", async () => {
    const tm = await import("../src/core/theme/theme-manager.ts");
    await tm.initThemeManager();
    const seen: unknown[] = [];
    tm.onThemeChange((c) => seen.push(c));

    await fireStorage({ BETTER_INTRA_THEME: { newValue: "dark" } });
    expect(seen).toEqual([{ theme: "dark", preset: "dark" }]);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await chrome.storage.local.set({ PROFILE_THEME_PRESET: "cupcake" });
    await fireStorage({ BETTER_INTRA_THEME: { newValue: "light" } });
    expect(seen[1]).toEqual({ theme: "light", preset: "cupcake" });
  });

  it("announces a preset change too, and unsubscribes", async () => {
    await chrome.storage.local.set({ BETTER_INTRA_THEME: "light" });
    const tm = await import("../src/core/theme/theme-manager.ts");
    await tm.initThemeManager();
    const cb = vi.fn();
    const off = tm.onThemeChange(cb);
    // Forest is a dark theme: the page follows it, whatever the stored mode
    await fireStorage({ PROFILE_THEME_PRESET: { newValue: "forest" } });
    expect(cb).toHaveBeenCalledWith({ theme: "dark", preset: "forest" });
    off();
    await fireStorage({ PROFILE_THEME_PRESET: { newValue: "dark" } });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("widgetTheme: a named preset wins, light/dark follow the page", async () => {
    const { widgetTheme } = await import("../src/core/theme/theme-manager.ts");
    expect(widgetTheme("light", "dark")).toBe("light");
    expect(widgetTheme("dark", "light")).toBe("dark");
    expect(widgetTheme("light", "forest")).toBe("forest");
  });
});

describe("friends widget state", () => {
  it("followTheme updates state.theme and re-renders once per change", async () => {
    const tm = await import("../src/core/theme/theme-manager.ts");
    const { followTheme } = await import("../src/features/friends/friends-widget-state.ts");
    const state = { theme: "dark" } as any;
    const rerender = vi.fn();
    const off = followTheme(state, rerender);

    document.dispatchEvent(
      new CustomEvent(tm.THEME_CHANGED_EVENT, { detail: { theme: "light", preset: "dark" } }),
    );
    expect(state.theme).toBe("light");
    expect(rerender).toHaveBeenCalledTimes(1);

    // same theme again: nothing to redraw
    document.dispatchEvent(
      new CustomEvent(tm.THEME_CHANGED_EVENT, { detail: { theme: "light", preset: "light" } }),
    );
    expect(rerender).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("profile info card", () => {
  it("flips the shadow-root wrapper's data-theme on a theme change", async () => {
    document.body.replaceChildren();
    await chrome.storage.local.set({ PROFILE_THEME_PRESET: "dark" });
    document.documentElement.classList.remove("dark");
    const tm = await import("../src/core/theme/theme-manager.ts");
    const card = await import("../src/features/profile/header/profile-card.ts");
    // no profile card on this page: init stops after reading the theme
    await card.initProfileCardStyling();

    const host = document.createElement("div");
    host.id = "profile-badges-shadow";
    const wrapper = document.createElement("div");
    wrapper.id = "ft-info-card";
    wrapper.setAttribute("data-theme", "light");
    host.attachShadow({ mode: "open" }).appendChild(wrapper);
    document.body.appendChild(host);

    document.dispatchEvent(
      new CustomEvent(tm.THEME_CHANGED_EVENT, { detail: { theme: "dark", preset: "dark" } }),
    );
    expect(wrapper.getAttribute("data-theme")).toBe("dark");
    document.dispatchEvent(
      new CustomEvent(tm.THEME_CHANGED_EVENT, { detail: { theme: "dark", preset: "forest" } }),
    );
    expect(wrapper.getAttribute("data-theme")).toBe("forest");
  });
});
