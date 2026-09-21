/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * src/loader.ts: content.js, the classic content script that runs at
 * document_start and imports the app (content-main.js). What it must do
 * synchronously (hook.js, the cached theme, the avatar pre-hide and its
 * fail-safe), that it holds no state, and that theme-manager.ts takes its
 * theme <link> over instead of adding a second one. See
 * docs/CODE-SPLITTING.md.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  STYLESHEET_ID,
  THEME_SHEETS,
} from "../src/core/theme/theme-manager.ts";

type Listener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

const listeners: Listener[] = [];
const getURL = vi.fn((file: string) => `chrome-extension://better-intra/${file}`);

/** jsdom's `location` cannot be redefined; vitest exposes the JSDOM instance. */
function goTo(url: string): void {
  (globalThis as unknown as { jsdom: { reconfigure(o: { url: string }): void } }).jsdom.reconfigure({
    url,
  });
}

const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  listeners.length = 0;
  getURL.mockClear();
  const c = chrome as unknown as Record<string, unknown>;
  c.runtime = { id: "better-intra", getURL };
  (chrome.storage as unknown as Record<string, unknown>).onChanged = {
    addListener: (fn: Listener) => listeners.push(fn),
    removeListener: () => {},
  };
  await chrome.storage.local.clear();
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  sessionStorage.clear();
  goTo("https://profile-v3.intra.42.fr/");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.dispatchEvent(new Event("pagehide"));
});

/** Evaluate the loader, then let its import() of the app fail (no such URL here). */
async function runLoader(): Promise<void> {
  await import("../src/loader.ts");
  await vi.dynamicImportSettled();
  await flush();
}

const themeLinks = () =>
  Array.from(document.querySelectorAll<HTMLLinkElement>("link[data-better-intra-theme]"));
const linksFor = (name: string) =>
  themeLinks().filter((l) => l.dataset.betterIntraTheme === name);
const enabled = (link: HTMLLinkElement) => link.media === "" || link.media === "all";
/** The page theme sheets that are on (the light-preset overrides ride on top). */
const pageSheetsOn = () =>
  themeLinks()
    .filter((l) => l.dataset.betterIntraTheme !== "lightPresetOverrides" && enabled(l))
    .map((l) => l.dataset.betterIntraTheme);

describe("loader: what it does at document_start", () => {
  it("injects hook.js first, then imports exactly content-main.js, and fails quietly", async () => {
    const added: Node[] = [];
    const obs = new MutationObserver((records) => {
      for (const r of records) added.push(...r.addedNodes);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    await runLoader();
    obs.disconnect();

    const script = added.find((n): n is HTMLScriptElement => n instanceof HTMLScriptElement);
    expect(script?.src).toBe("chrome-extension://better-intra/hook.js");
    expect(script?.isConnected).toBe(false); // removed once inserted, as before
    // hook.js first, the app last, and the app has ONE URL: no query, no hash.
    const files = getURL.mock.calls.map(([f]) => f);
    expect(files[0]).toBe("hook.js");
    expect(files.at(-1)).toBe("content-main.js");
    expect(files.filter((f) => f.startsWith("content-main"))).toEqual(["content-main.js"]);
    // The import cannot succeed in a test: it must not throw into the page.
    expect(warn).toHaveBeenCalledWith(
      "Better Intra: the extension could not start on this page.",
      expect.anything(),
    );
  });

  it("applies the cached dark theme on v3 with the theme manager's names", async () => {
    sessionStorage.setItem("intra-theme", "dark");
    await runLoader();
    const root = document.documentElement;
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.getAttribute("data-theme")).toBe("dark");
    const links = themeLinks();
    expect(links).toHaveLength(1);
    expect(links[0].dataset.betterIntraTheme).toBe("darkV3");
    expect(links[0].id).toBe(STYLESHEET_ID);
    expect(links[0].rel).toBe("stylesheet");
    expect(links[0].href).toBe(`chrome-extension://better-intra/${THEME_SHEETS.darkV3}`);
    // It reads the cache, it never writes it.
    expect(sessionStorage.getItem("intra-theme")).toBe("dark");
  });

  it("applies the cached light theme on v3", async () => {
    document.documentElement.classList.add("dark");
    sessionStorage.setItem("intra-theme", "light");
    await runLoader();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(themeLinks().map((l) => l.href)).toEqual([
      `chrome-extension://better-intra/${THEME_SHEETS.lightV3}`,
    ]);
  });

  it("uses the v2 sheet off profile-v3, and no sheet for light there", async () => {
    goTo("https://profile.intra.42.fr/");
    sessionStorage.setItem("intra-theme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
    await runLoader();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(themeLinks().map((l) => [l.dataset.betterIntraTheme, l.href])).toEqual([
      ["darkV2", `chrome-extension://better-intra/${THEME_SHEETS.darkV2}`],
    ]);

    vi.resetModules();
    document.head.replaceChildren();
    sessionStorage.setItem("intra-theme", "light");
    await runLoader();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(themeLinks()).toHaveLength(0);
  });

  it("does nothing to the theme without a cached one, or with blocked storage", async () => {
    await runLoader();
    expect(themeLinks()).toHaveLength(0);
    expect(document.documentElement.className).toBe("");

    vi.resetModules();
    getURL.mockClear();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    await expect(runLoader()).resolves.toBeUndefined();
    expect(themeLinks()).toHaveLength(0);
    // The rest still ran.
    expect(getURL.mock.calls.map(([f]) => f)).toEqual(["hook.js", "content-main.js"]);
  });

  it("hides the Intra avatar as soon as it is inserted, and brings it back after 5 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await import("../src/loader.ts");
    const wrapper = document.createElement("div");
    const avatar = document.createElement("div");
    avatar.className = "rounded-full w-52 h-52";
    wrapper.appendChild(avatar);
    document.body.appendChild(wrapper);
    await flush();
    expect(avatar.style.getPropertyValue("opacity")).toBe("0");
    expect(avatar.style.getPropertyPriority("opacity")).toBe("important");

    // One avatar only: the observer is gone after the first.
    const second = document.createElement("div");
    second.className = "rounded-full w-52 h-52";
    document.body.appendChild(second);
    await flush();
    expect(second.style.getPropertyValue("opacity")).toBe("");

    // The fail-safe lives in the loader: it runs even though the app never
    // loaded (it cannot, in a test).
    vi.advanceTimersByTime(5000);
    expect(avatar.style.getPropertyValue("opacity")).toBe("1");
    vi.useRealTimers();
    await vi.dynamicImportSettled();
  });
});

describe("theme manager after the loader", () => {
  async function startThemeManager(settings: Record<string, unknown>) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
    );
    await chrome.storage.local.set(settings);
    const tm = await import("../src/core/theme/theme-manager.ts");
    await tm.initThemeManager();
    await flush(20);
    return tm;
  }

  async function change(settings: Record<string, unknown>) {
    const changes: Record<string, chrome.storage.StorageChange> = {};
    for (const [key, value] of Object.entries(settings)) changes[key] = { newValue: value };
    await chrome.storage.local.set(settings);
    for (const l of listeners.slice()) l(changes, "local");
    await flush(20);
  }

  it("adopts the loader's link: one link per sheet, one page sheet on, through every switch", async () => {
    sessionStorage.setItem("intra-theme", "dark");
    await runLoader();
    const fromLoader = linksFor("darkV3")[0];
    expect(fromLoader).toBeDefined();

    await startThemeManager({ BETTER_INTRA_THEME: "dark" });
    expect(linksFor("darkV3")).toEqual([fromLoader]);
    expect(pageSheetsOn()).toEqual(["darkV3"]);
    expect(fromLoader.id).toBe(STYLESHEET_ID);

    await change({ BETTER_INTRA_THEME: "light" });
    expect(linksFor("darkV3")).toEqual([fromLoader]);
    expect(linksFor("lightV3")).toHaveLength(1);
    expect(pageSheetsOn()).toEqual(["lightV3"]);
    expect(fromLoader.media).toBe("not all");
    expect(fromLoader.id).toBe("");

    await change({ PROFILE_THEME_PRESET: "valentine" });
    expect(pageSheetsOn()).toEqual(["lightV3"]);
    expect(linksFor("lightPresetOverrides")).toHaveLength(1);
    expect(enabled(linksFor("lightPresetOverrides")[0])).toBe(true);

    await change({ BETTER_INTRA_THEME: "dark", PROFILE_THEME_PRESET: "synthwave" });
    expect(pageSheetsOn()).toEqual(["darkV3"]);
    expect(enabled(linksFor("lightPresetOverrides")[0])).toBe(false);
    for (const name of ["darkV3", "lightV3", "lightPresetOverrides"]) {
      expect(linksFor(name)).toHaveLength(1);
    }
    expect(document.querySelectorAll(`#${STYLESHEET_ID}`)).toHaveLength(1);
  });

  it("turns the loader's sheet off when the settings disagree with the cache", async () => {
    // Cached dark from the previous page, light in the settings: the manager
    // never asks for darkV3 itself, it must still switch the loader's one off.
    sessionStorage.setItem("intra-theme", "dark");
    await runLoader();
    await startThemeManager({ BETTER_INTRA_THEME: "light" });
    expect(pageSheetsOn()).toEqual(["lightV3"]);
    expect(linksFor("darkV3")).toHaveLength(1);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("keeps one link when a previous instance left one behind", async () => {
    const stale = document.createElement("link");
    stale.rel = "stylesheet";
    stale.dataset.betterIntraTheme = "darkV3";
    document.head.appendChild(stale);
    sessionStorage.setItem("intra-theme", "dark");
    await runLoader();
    expect(linksFor("darkV3")).toHaveLength(2);
    await startThemeManager({ BETTER_INTRA_THEME: "dark" });
    expect(linksFor("darkV3")).toHaveLength(1);
    expect(pageSheetsOn()).toEqual(["darkV3"]);
  });
});

describe("loader: no state (docs/CODE-SPLITTING.md, rule 1)", () => {
  /** The code of a source file, comments left out. */
  const read = (rel: string) =>
    fs
      .readFileSync(path.resolve(__dirname, "..", rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("imports only constant modules and never touches chrome.storage", () => {
    const src = read("src/loader.ts");
    const imports = [...src.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports).toEqual(["./core/intra/selectors.ts"]);
    expect(src).not.toMatch(/chrome\.storage|setItem|removeItem/);
    // No module-level mutable state.
    expect(src).not.toMatch(/^(let|var)\s/m);

    const selectors = read("src/core/intra/selectors.ts");
    expect(selectors).not.toMatch(/^\s*(import|let|var|function|class)\b/m);
    expect(selectors).not.toMatch(/chrome\./);
  });
});
