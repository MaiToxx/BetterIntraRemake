import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { splitDaisyThemes } from "../vite.config.ts";

/**
 * shared-styles.ts is a page-wide singleton: one fetch, one parsed sheet, one
 * <link> fallback policy. Every case therefore installs its own chrome / fetch
 * / CSSStyleSheet stubs and re-imports the module with a clean registry, so the
 * memoisation under test is the one this case created.
 */

const CSS_FILE = "shared-styles.css";
const CSS_URL = `chrome-extension://better-intra/${CSS_FILE}`;
const CSS_TEXT = ":host{display:block}";
const THEMES_FILE = "shared-themes.css";
const THEMES_URL = `chrome-extension://better-intra/${THEMES_FILE}`;
const THEMES_TEXT = "@layer base{[data-theme=cupcake]{--color-base-100:#eee}}";
/** Where shared-styles.ts remembers the preset of the tab's previous page. */
const PRESET_KEY = "better-intra-theme-preset";

/** Stand-in for a constructable stylesheet; jsdom has none. */
class FakeSheet {
  cssText = "";
  replaceSync(css: string) {
    this.cssText = css;
  }
}

const realCSSStyleSheet = (globalThis as Record<string, unknown>).CSSStyleSheet;
const realFetch = (globalThis as Record<string, unknown>).fetch;
const realChrome = (globalThis as Record<string, unknown>).chrome;

function installChrome() {
  (globalThis as Record<string, unknown>).chrome = {
    ...(realChrome as object),
    runtime: { getURL: vi.fn((file: string) => `chrome-extension://better-intra/${file}`) },
  };
}

function installFetch(impl: (url: string) => Promise<unknown>) {
  const mock = vi.fn(impl);
  (globalThis as Record<string, unknown>).fetch = mock;
  return mock;
}

function okResponse() {
  return Promise.resolve({ ok: true, text: () => Promise.resolve(CSS_TEXT) });
}

/** Serves both sheets; `themes` replaces the themes answer (e.g. one that never comes). */
function installFetchByUrl(themes?: Promise<unknown>) {
  return installFetch((url) =>
    url === THEMES_URL
      ? (themes ?? Promise.resolve({ ok: true, text: () => Promise.resolve(THEMES_TEXT) }))
      : okResponse(),
  );
}

/**
 * chrome with a storage area holding PROFILE_THEME_PRESET (a value, or a
 * function for an answer that comes later) and an onChanged that `change()`
 * fires, the way another tab or the hub would.
 */
function installChromeWithPreset(preset: string | (() => Promise<string>)) {
  const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
  let value = preset;
  (globalThis as Record<string, unknown>).chrome = {
    runtime: { getURL: vi.fn((file: string) => `chrome-extension://better-intra/${file}`) },
    storage: {
      local: {
        get: vi.fn(async () => ({
          PROFILE_THEME_PRESET: typeof value === "function" ? await value() : value,
        })),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
      },
      onChanged: { addListener: vi.fn((fn: (typeof listeners)[number]) => listeners.push(fn)) },
    },
  };
  return {
    change(next: string) {
      value = next;
      for (const fn of listeners) fn({ PROFILE_THEME_PRESET: { newValue: next } }, "local");
    },
  };
}

/** Let every pending promise (storage read, fetch, parse) settle. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function textsOf(root: ShadowRoot): string[] {
  return adoptedOf(root).map((s) => s.cssText);
}

function useConstructableSheets(on: boolean) {
  if (on) (globalThis as Record<string, unknown>).CSSStyleSheet = FakeSheet;
  else delete (globalThis as Record<string, unknown>).CSSStyleSheet;
}

function makeRoot(): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  // jsdom does not implement adoptedStyleSheets; a plain array is enough for
  // the helper to exercise its real adoption path.
  if (!Array.isArray((root as unknown as { adoptedStyleSheets?: unknown }).adoptedStyleSheets)) {
    Object.defineProperty(root, "adoptedStyleSheets", {
      value: [],
      writable: true,
      configurable: true,
    });
  }
  return root;
}

function adoptedOf(root: ShadowRoot): FakeSheet[] {
  return (root as unknown as { adoptedStyleSheets: FakeSheet[] }).adoptedStyleSheets;
}

async function loadModule() {
  vi.resetModules();
  return await import("../src/core/styles/shared-styles.ts");
}

beforeEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  installChrome();
});

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as Record<string, unknown>).chrome = realChrome;
  if (realCSSStyleSheet === undefined)
    delete (globalThis as Record<string, unknown>).CSSStyleSheet;
  else (globalThis as Record<string, unknown>).CSSStyleSheet = realCSSStyleSheet;
  if (realFetch === undefined) delete (globalThis as Record<string, unknown>).fetch;
  else (globalThis as Record<string, unknown>).fetch = realFetch;
});

describe("preloadSharedStyles", () => {
  it("fetches the sheet once however many roots ask for it", async () => {
    useConstructableSheets(true);
    const fetchMock = installFetch(okResponse);
    const mod = await loadModule();

    await mod.preloadSharedStyles();
    await mod.preloadSharedStyles();
    const roots = [makeRoot(), makeRoot(), makeRoot()];
    for (const root of roots) mod.adoptSharedStyles(root);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(CSS_URL);
    // One parsed sheet instance shared by every root: that is the whole point.
    const first = adoptedOf(roots[0])[0];
    expect(first).toBeInstanceOf(FakeSheet);
    expect(first.cssText).toBe(CSS_TEXT);
    for (const root of roots) expect(adoptedOf(root)[0]).toBe(first);
  });

  it("does not memoise a missing extension context", async () => {
    useConstructableSheets(true);
    const fetchMock = installFetch(okResponse);
    (globalThis as Record<string, unknown>).chrome = { runtime: {} };
    const mod = await loadModule();

    expect(await mod.preloadSharedStyles()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    installChrome();
    expect(await mod.preloadSharedStyles()).toBeInstanceOf(FakeSheet);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("adoptSharedStyles", () => {
  it("puts the widget's own rules after the shared sheet", async () => {
    useConstructableSheets(true);
    installFetch(okResponse);
    const mod = await loadModule();
    await mod.preloadSharedStyles();

    const root = makeRoot();
    mod.adoptSharedStyles(root, ".pill{color:red}");

    const adopted = adoptedOf(root);
    expect(adopted).toHaveLength(2);
    expect(adopted[0].cssText).toBe(CSS_TEXT);
    // Last wins ties, exactly as when both strings sat in one <style>.
    expect(adopted[1].cssText).toBe(".pill{color:red}");
  });

  it("is a no-op the second time on the same root", async () => {
    useConstructableSheets(true);
    installFetch(okResponse);
    const mod = await loadModule();
    await mod.preloadSharedStyles();

    const root = makeRoot();
    mod.adoptSharedStyles(root);
    mod.adoptSharedStyles(root);
    mod.adoptSharedStyles(root, ".pill{color:red}");

    expect(adoptedOf(root)).toHaveLength(1);
  });

  it("falls back to a <link> when the browser has no constructable stylesheets", async () => {
    useConstructableSheets(false);
    const fetchMock = installFetch(okResponse);
    const mod = await loadModule();

    expect(await mod.preloadSharedStyles()).toBeNull();
    // Nothing to build a CSSStyleSheet with, so do not even fetch.
    expect(fetchMock).not.toHaveBeenCalled();

    const root = makeRoot();
    mod.adoptSharedStyles(root, ".pill{color:red}");

    const link = root.querySelector("link");
    expect(link?.getAttribute("rel")).toBe("stylesheet");
    expect(link?.getAttribute("href")).toBe(CSS_URL);
    // Shared sheet first, widget rules second: same cascade as the adopt path.
    expect(root.children[0]).toBe(link);
    expect((root.children[1] as HTMLStyleElement).textContent).toBe(".pill{color:red}");
    expect(adoptedOf(root)).toHaveLength(0);
  });

  it("never adopts and links at the same time", async () => {
    useConstructableSheets(true);
    installFetch(okResponse);
    const mod = await loadModule();
    await mod.preloadSharedStyles();

    const root = makeRoot();
    mod.adoptSharedStyles(root, ".pill{color:red}");

    expect(adoptedOf(root)).toHaveLength(2);
    expect(root.querySelector("link")).toBeNull();
    expect(root.querySelector("style")).toBeNull();
  });

  it("leaves the widget renderable when the fetch fails", async () => {
    useConstructableSheets(true);
    const fetchMock = installFetch(() => Promise.reject(new Error("offline")));
    const mod = await loadModule();

    expect(await mod.preloadSharedStyles()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const root = makeRoot();
    expect(() => mod.adoptSharedStyles(root)).not.toThrow();

    const content = document.createElement("span");
    content.textContent = "still here";
    root.appendChild(content);
    expect(root.textContent).toBe("still here");
    expect(adoptedOf(root)).toHaveLength(0);
  });

  it("does not crash without an extension context", async () => {
    useConstructableSheets(true);
    installFetch(okResponse);
    (globalThis as Record<string, unknown>).chrome = { runtime: {} };
    const mod = await loadModule();

    const root = makeRoot();
    expect(() => mod.adoptSharedStyles(root, ".pill{color:red}")).not.toThrow();
    // Unstyled by Tailwind, but the widget's own rules still land.
    expect(root.querySelector("link")).toBeNull();
    expect(root.querySelector("style")?.textContent).toBe(".pill{color:red}");
  });
});

describe("sharedStylesLink", () => {
  it("renders a stylesheet link pointing at the asset", async () => {
    useConstructableSheets(true);
    installFetch(okResponse);
    const mod = await loadModule();
    const { render } = await import("lit-html");

    const root = makeRoot();
    render(mod.sharedStylesLink(), root);

    const link = root.querySelector("link");
    expect(link?.getAttribute("rel")).toBe("stylesheet");
    expect(link?.getAttribute("href")).toBe(CSS_URL);
  });

  it("keeps the same element across re-renders, so nothing is refetched", async () => {
    useConstructableSheets(true);
    installFetch(okResponse);
    const mod = await loadModule();
    const { html, render } = await import("lit-html");

    const root = makeRoot();
    const widget = (n: number) =>
      html`${mod.sharedStylesLink()}<style>
          .n {
            z-index: ${n};
          }
        </style>`;
    render(widget(1), root);
    const first = root.querySelector("link");
    render(widget(2), root);

    expect(root.querySelectorAll("link")).toHaveLength(1);
    expect(root.querySelector("link")).toBe(first);
    // And the shared sheet still comes before the widget's own rules.
    expect(root.querySelector("link")!.compareDocumentPosition(root.querySelector("style")!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders nothing without an extension context", async () => {
    (globalThis as Record<string, unknown>).chrome = { runtime: {} };
    const mod = await loadModule();
    const { render } = await import("lit-html");

    const root = makeRoot();
    render(mod.sharedStylesLink(), root);

    expect(root.querySelector("link")).toBeNull();
  });
});

/*
 * shared-themes.css: the 34 hub presets besides light and dark, which only a
 * page whose preset needs them loads. Same fetch-once / adopt / <link> rules as
 * the shared sheet, always right after it.
 */
describe("shared-themes.css", () => {
  it("is never fetched on a light/dark page", async () => {
    useConstructableSheets(true);
    installChromeWithPreset("dark");
    const fetchMock = installFetchByUrl();
    const mod = await loadModule();
    await mod.preloadSharedStyles();
    await flush();

    const root = makeRoot();
    mod.adoptSharedStyles(root, ".pill{color:red}");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(CSS_URL);
    expect(textsOf(root)).toEqual([CSS_TEXT, ".pill{color:red}"]);
    expect(sessionStorage.getItem(PRESET_KEY)).toBe("dark");
  });

  it("starts at document_start when the tab's last page had a preset, then sits between the shared sheet and the widget's rules", async () => {
    useConstructableSheets(true);
    sessionStorage.setItem(PRESET_KEY, "cupcake");
    installChromeWithPreset("cupcake");
    const fetchMock = installFetchByUrl();
    const mod = await loadModule();

    // Before the storage read has even answered.
    expect(fetchMock).toHaveBeenCalledWith(THEMES_URL);
    await flush();

    const root = makeRoot();
    mod.adoptSharedStyles(root, ".pill{color:red}");
    expect(textsOf(root)).toEqual([CSS_TEXT, THEMES_TEXT, ".pill{color:red}"]);
    expect(root.querySelector("link")).toBeNull();
    // One parsed sheet for the whole page.
    const other = makeRoot();
    mod.adoptSharedStyles(other);
    expect(adoptedOf(other)[1]).toBe(adoptedOf(root)[1]);
    expect(fetchMock.mock.calls.filter(([url]) => url === THEMES_URL)).toHaveLength(1);
  });

  it("follows the stored preset, and themes the roots served before it was known", async () => {
    useConstructableSheets(true);
    let answer!: (preset: string) => void;
    const stored = new Promise<string>((resolve) => (answer = resolve));
    installChromeWithPreset(() => stored);
    const fetchMock = installFetchByUrl();
    const mod = await loadModule();
    await mod.preloadSharedStyles();

    const root = makeRoot();
    mod.adoptSharedStyles(root, ".pill{color:red}");
    expect(textsOf(root)).toEqual([CSS_TEXT, ".pill{color:red}"]);
    expect(fetchMock).not.toHaveBeenCalledWith(THEMES_URL);

    answer("synthwave");
    await flush();

    expect(textsOf(root)).toEqual([CSS_TEXT, THEMES_TEXT, ".pill{color:red}"]);
    expect(sessionStorage.getItem(PRESET_KEY)).toBe("synthwave");
  });

  it("reaches roots already on screen when a preset is picked, adopted and linked ones alike", async () => {
    useConstructableSheets(true);
    const storage = installChromeWithPreset("dark");
    const fetchMock = installFetchByUrl();
    const mod = await loadModule();
    const { html, render } = await import("lit-html");
    await mod.preloadSharedStyles();
    await flush();

    const adopted = makeRoot();
    mod.adoptSharedStyles(adopted, ".pill{color:red}");
    const linked = makeRoot();
    render(
      html`${mod.sharedStylesLink()}<style>
          .n {
            z-index: 1;
          }
        </style>`,
      linked,
    );
    // jsdom loads no stylesheet; a browser fires this once the file is in.
    linked.querySelector("link")!.dispatchEvent(new Event("load"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    storage.change("cupcake");
    await flush();

    expect(textsOf(adopted)).toEqual([CSS_TEXT, THEMES_TEXT, ".pill{color:red}"]);
    // Its shared sheet is the <link>, which tree order already puts first.
    expect(textsOf(linked)).toEqual([THEMES_TEXT]);
    expect(linked.querySelectorAll("link")).toHaveLength(1);

    // A widget rendered from now on carries the themes <link> itself.
    const later = makeRoot();
    render(mod.sharedStylesLink(), later);
    expect([...later.querySelectorAll("link")].map((l) => l.getAttribute("href"))).toEqual([
      CSS_URL,
      THEMES_URL,
    ]);
  });

  it("falls back to links, themes included, rather than render first and theme later", async () => {
    useConstructableSheets(true);
    sessionStorage.setItem(PRESET_KEY, "cupcake");
    installChromeWithPreset("cupcake");
    installFetchByUrl(new Promise(() => {})); // the themes never arrive
    const mod = await loadModule();
    await mod.preloadSharedStyles();

    const root = makeRoot();
    mod.adoptSharedStyles(root, ".pill{color:red}");

    const nodes = [...root.children];
    expect(nodes.map((n) => n.tagName)).toEqual(["LINK", "LINK", "STYLE"]);
    expect(nodes[0].getAttribute("href")).toBe(CSS_URL);
    expect(nodes[1].getAttribute("href")).toBe(THEMES_URL);
    expect(nodes[2].textContent).toBe(".pill{color:red}");
    expect(adoptedOf(root)).toHaveLength(0);
  });

  it("puts the themes <link> between the shared <link> and the widget's <style>, stable across re-renders", async () => {
    useConstructableSheets(true);
    sessionStorage.setItem(PRESET_KEY, "cupcake");
    installChromeWithPreset("cupcake");
    installFetchByUrl();
    const mod = await loadModule();
    const { html, render } = await import("lit-html");

    const root = makeRoot();
    const widget = (n: number) =>
      html`${mod.sharedStylesLink()}<style>
          .n {
            z-index: ${n};
          }
        </style>`;
    render(widget(1), root);
    const [shared, themes] = root.querySelectorAll("link");
    render(widget(2), root);

    expect(shared.getAttribute("href")).toBe(CSS_URL);
    expect(themes.getAttribute("href")).toBe(THEMES_URL);
    expect([...root.querySelectorAll("link")]).toEqual([shared, themes]);
    expect(shared.compareDocumentPosition(themes)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(themes.compareDocumentPosition(root.querySelector("style")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("still works when the page blocks sessionStorage", async () => {
    useConstructableSheets(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    installChromeWithPreset("cupcake");
    const fetchMock = installFetchByUrl();
    const mod = await loadModule();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(THEMES_URL);
    const root = makeRoot();
    mod.adoptSharedStyles(root);
    expect(textsOf(root)).toEqual([CSS_TEXT, THEMES_TEXT]);
  });
});

/*
 * What goes INTO shared-styles.css. style.css trims the sheet three ways (see
 * the comments there): Tailwind scans src/ only, daisyUI builds only the
 * components src/ uses, and each theme is one [data-theme] rule instead of two
 * copies prefixed with the widget root ids. A lost rule is a silently unstyled
 * widget, so these cases compile the real style.css exactly like
 * @tailwindcss/vite does (same compiler, same scanner, same lightningcss pass)
 * and check the result against src/.
 */

const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "src");
const STYLE_CSS = path.join(SRC, "core", "styles", "style.css");
const POPUP_CONFIG = path.join(REPO, "vite.popup.config.ts");

type TailwindNode = {
  compile: (
    css: string,
    opts: { base: string; from: string; onDependency: (p: string) => void },
  ) => Promise<{
    root: "none" | null | { base: string; pattern: string };
    sources: { base: string; pattern: string; negated: boolean }[];
    build: (candidates: string[]) => string;
  }>;
  optimize: (css: string, opts: { minify: boolean }) => { code: string };
};
type Oxide = {
  Scanner: new (opts: { sources: { base: string; pattern: string; negated: boolean }[] }) => {
    scan: () => string[];
  };
};

/** Compile a style.css text the way @tailwindcss/vite does for a build. */
async function compileSheet(css: string): Promise<string> {
  // Both ship with @tailwindcss/vite, which is what the build itself runs.
  const { compile, optimize } = (await import("@tailwindcss/node")) as unknown as TailwindNode;
  const { Scanner } = (await import("@tailwindcss/oxide")) as unknown as Oxide;
  const compiler = await compile(css, {
    base: path.dirname(STYLE_CSS),
    from: STYLE_CSS,
    onDependency() {},
  });
  const root =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: REPO, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const scanner = new Scanner({ sources: [...root, ...compiler.sources] });
  return optimize(compiler.build(scanner.scan()), { minify: true }).code;
}

type Rule = { selectors: string[]; body: string };

/** Every style rule, flattened out of @media/@layer/@supports/... */
function rulesOf(css: string): Rule[] {
  const out: Rule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const walk = (t: string) => {
    let depth = 0;
    let start = 0;
    let open = -1;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === "{") {
        if (depth === 0) open = i;
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          const head = t.slice(start, open).trim();
          const body = t.slice(open + 1, i);
          if (/^@(media|supports|layer|container|scope|starting-style)\b/.test(head)) walk(body);
          else if (!head.startsWith("@")) out.push({ selectors: splitList(head), body });
          start = i + 1;
        }
      } else if (c === ";" && depth === 0) {
        start = i + 1;
      }
    }
  };
  walk(text);
  return out;
}

function selectorsOf(rules: Rule[]): Set<string> {
  return new Set(rules.flatMap((r) => r.selectors));
}

function splitList(head: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of head) {
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** First class a selector names (unescaped), or null. */
function leadingClass(selector: string): string | null {
  const m = selector.match(/\.((?:\\.|[A-Za-z0-9_-])+)/);
  return m ? m[1].replace(/\\(.)/g, "$1") : null;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    // .css is left out on purpose: Tailwind never scans it, and the theme
    // sheets / style.css name classes as selectors, not as markup.
    else if (/\.(ts|svg|json|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Class names src/ can put on an element: class="..." / className values
 * (string parts and the string literals of their ${...}), className: "..." in
 * Object.assign, classList.add/toggle(...) and setAttribute("class", ...).
 * Deliberately generous; a false positive here only makes the check stricter.
 */
function classesWrittenBySrc(): Set<string> {
  const classes = new Set<string>();
  const TOKEN = /^[!A-Za-z0-9_:\-/.[\]#%()]+$/;
  const take = (text: string) => {
    for (const tok of text.split(/\s+/)) if (tok && TOKEN.test(tok)) classes.add(tok);
  };
  const literals = (text: string) =>
    [...text.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]);
  for (const file of [...sourceFiles(SRC), POPUP_CONFIG]) {
    const t = fs.readFileSync(file, "utf8");
    const attr = /\bclass(?:Name)?\s*(?:=|:)\s*(["'`])/g;
    let m: RegExpExecArray | null;
    while ((m = attr.exec(t))) {
      const quote = m[1];
      let i = attr.lastIndex;
      let depth = 0;
      let plain = "";
      let inner = "";
      while (i < t.length) {
        if (t[i] === "$" && t[i + 1] === "{") {
          depth++;
          plain += " ";
          i += 2;
          continue;
        }
        if (depth > 0 && t[i] === "}") {
          depth--;
          i++;
          continue;
        }
        if (depth === 0 && t[i] === quote) break;
        if (depth === 0) plain += t[i];
        else inner += t[i];
        i++;
      }
      take(plain);
      for (const l of literals(inner)) take(l);
    }
    const call = /\b(?:classList\.(?:add|toggle)|setAttribute)\s*\(/g;
    while ((m = call.exec(t))) {
      let i = call.lastIndex;
      let depth = 1;
      const from = i;
      while (i < t.length && depth) {
        if (t[i] === "(") depth++;
        else if (t[i] === ")") depth--;
        i++;
      }
      const args = t.slice(from, i - 1);
      if (m[0].startsWith("setAttribute") && !/^\s*["']class["']/.test(args)) continue;
      for (const l of literals(args)) take(l);
    }
  }
  return classes;
}

/**
 * daisyUI components whose classes src/ writes but that the sheet has NEVER
 * built (v1.10.0 did not include them either: its shipped shared-styles.css has
 * no .checkbox / .validator rule). Those elements have always had the browser's
 * look; adding the component would restyle live widgets, which is a design
 * decision, not a size one. "carousel" is an extractor false positive.
 */
const NEVER_STYLED: Record<string, string> = {
  checkbox: "customize/cards.ui.ts and friends.ui.ts use checkbox-* classes",
  validator: "hubSettings.ui.ts and profile.modal.ts put it on inputs",
  carousel: 'not a class: the "carousel" operand of a comparison in logtime/render.ts',
};

function neverStyled(cls: string): boolean {
  return Object.keys(NEVER_STYLED).some((c) => cls === c || cls.startsWith(`${c}-`));
}

/**
 * Every id the v1.10.0 style.css passed to daisyUI's `root` option. Some of
 * them no longer exist in src/; the list is the regression guard, not a map of
 * live widgets.
 */
const ROOT_IDS = [
  "hub-shadow-wrapper", "events-shadow-wrapper", "profile-shadow-wrapper",
  "profile-badges-shadow", "cluster-shadow-host", "shortcuts-shadow-wrapper",
  "friends-shadow-wrapper", "ft-friend-btn-shadow", "logtime-shadow-wrapper",
  "popup-root", "project-badges-shadow", "cluster-map-dialog",
  "profile-modal-host", "better-intra-sort-host", "ft-tracker-card",
  "ft-transcript-dialog", "ft-star-total-host", "ft-subject-update-host",
];

/** Every theme name, as the hub offers them. */
function hubThemes(): string[] {
  return Object.keys(
    JSON.parse(fs.readFileSync(path.join(SRC, "core/theme/themes.json"), "utf8")) as Record<
      string,
      unknown
    >,
  );
}

/** The declarations of the one rule whose selector list names [data-theme=theme]. */
function themeDeclarations(rules: Rule[], theme: string): Record<string, string> | null {
  const found = rules.filter((r) => r.selectors.some((s) => s.includes(`[data-theme=${theme}]`)));
  if (found.length !== 1) return null;
  const out: Record<string, string> = {};
  for (const decl of found[0].body.split(";")) {
    const colon = decl.indexOf(":");
    if (colon > 0) out[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim();
  }
  return out;
}

describe("shared-styles.css contents", () => {
  let styleCss = "";
  /** The sheet as Tailwind compiles style.css, before the build splits it. */
  let fullCss = "";
  /** shared-styles.css and shared-themes.css, as splitDaisyThemes() writes them. */
  let coreCss = "";
  let themesCss = "";
  let coreRules: Rule[];
  /** Both files: everything that ships. */
  let realRules: Rule[];
  let real: Set<string>;
  let reference: Set<string>;
  let srcClasses: Set<string>;

  beforeAll(async () => {
    styleCss = fs.readFileSync(STYLE_CSS, "utf8");
    // Same file with every daisyUI component and no candidate exclusions: what
    // src/ would get if nothing had been trimmed.
    const untrimmed = styleCss
      .replace(/@source not inline\([^)]*\);/g, "")
      .replace(/\n\s*include:[^;]*;/, "");
    expect(untrimmed).not.toBe(styleCss);
    const [realCss, referenceCss] = await Promise.all([
      compileSheet(styleCss),
      compileSheet(untrimmed),
    ]);
    fullCss = realCss;
    ({ core: coreCss, themes: themesCss } = splitDaisyThemes(realCss));
    coreRules = rulesOf(coreCss);
    realRules = rulesOf(coreCss + themesCss);
    real = selectorsOf(realRules);
    reference = selectorsOf(rulesOf(referenceCss));
    srcClasses = classesWrittenBySrc();
  }, 120_000);

  it("scans src/ (and the popup.html template) only", () => {
    // Auto-detection read the whole repo: .agents/, tests/, docs, *.md.
    expect(styleCss).toMatch(/@import\s+"tailwindcss"\s+source\(none\);/);
    // style.css lives in src/core/styles/: "../../" is src/, one more is the repo
    expect(styleCss).toMatch(/@source\s+"\.\.\/\.\.\/";/);
    expect(styleCss).toMatch(/@source\s+"\.\.\/\.\.\/\.\.\/vite\.popup\.config\.ts";/);
    expect(real.has(".p-4")).toBe(true); // popup.html's only class
  });

  it("passes daisyUI a real include list, not one bracketed string", () => {
    // A bracketed list reaches daisyUI as a single string that it
    // substring-matches, which silently changes what gets built.
    const include = styleCss.match(/\n\s*include:([^;]*);/);
    expect(include).not.toBeNull();
    expect(include![1]).not.toMatch(/[[\]]/);
  });

  it("keeps every rule keyed on a class src/ writes", () => {
    expect(srcClasses.size).toBeGreaterThan(300);
    const lost = [...reference].filter((sel) => {
      const cls = leadingClass(sel);
      return cls !== null && srcClasses.has(cls) && !neverStyled(cls) && !real.has(sel);
    });
    // If this fails, src/ started using a daisyUI component (or a candidate)
    // that style.css leaves out: add it back to `include` / drop the exclusion.
    expect(lost).toEqual([]);
  });

  it("still trims something, or the trimming above went away", () => {
    const trimmed = [...reference].filter((sel) => !real.has(sel));
    expect(trimmed.length).toBeGreaterThan(0);
    expect(trimmed.some((sel) => sel.startsWith(".tooltip"))).toBe(true);
    expect(trimmed).toContain(".\\!loading");
  });

  it("applies every hub preset through its own [data-theme] rule", async () => {
    const themes = hubThemes();
    expect(themes).toHaveLength(36);
    const selectorText = [...real].join("\n");
    for (const theme of themes) expect(selectorText).toContain(`[data-theme=${theme}]`);
  });

  it("keeps light and dark in shared-styles.css and moves the other 34 presets out", () => {
    const named = (css: string) =>
      [...new Set([...css.matchAll(/\[data-theme=([a-z0-9-]+)\]/g)].map((m) => m[1]))].sort();
    expect(named(coreCss)).toEqual(["dark", "light"]);
    expect(named(themesCss)).toEqual(hubThemes().filter((t) => t !== "light" && t !== "dark").sort());
    // Nothing but theme blocks, in the layer they came from.
    expect(themesCss.startsWith("@layer base{")).toBe(true);
    expect(themesCss.endsWith("}}")).toBe(true);
    const themeRules = rulesOf(themesCss);
    expect(themeRules).toHaveLength(34);
    for (const rule of themeRules) expect(rule.body).toMatch(/--color-base-100\s*:/);
    // Nothing lost, nothing added: the two files are the one sheet, cut in two.
    expect(coreCss.length + themesCss.length - "@layer base{}".length).toBe(fullCss.length);
    expect(themesCss.length).toBeGreaterThan(30_000);
  });

  it("cuts the themes from the tail of @layer base, so core + themes is the old cascade", () => {
    // Put the moved blocks back where they came from: the result must be the
    // compiled sheet itself, byte for byte. And they must have been the last
    // rules of the one @layer base block: a later sheet that re-opens the layer
    // then keeps every rule in its old place in the cascade.
    const inner = themesCss.slice("@layer base{".length, -1);
    const at = fullCss.indexOf(inner);
    expect(at).toBeGreaterThan(0);
    expect(coreCss).toBe(fullCss.slice(0, at) + fullCss.slice(at + inner.length));
    const baseStart = fullCss.indexOf("@layer base{");
    expect(baseStart).toBeGreaterThan(-1);
    expect(baseStart).toBeLessThan(at);
    expect(fullCss.indexOf("@layer base{", baseStart + 1)).toBe(-1);
    // Right after the moved blocks comes the "}" that closes @layer base.
    let depth = 0;
    let baseEnd = -1;
    for (let i = baseStart; i < fullCss.length; i++) {
      if (fullCss[i] === "{") depth++;
      else if (fullCss[i] === "}" && --depth === 0) {
        baseEnd = i;
        break;
      }
    }
    expect(baseEnd).toBe(at + inner.length);
  });

  it("resolves every one of the 36 themes to the same variables as the single sheet did", () => {
    const fullRules = rulesOf(fullCss);
    const themesRules = rulesOf(themesCss);
    for (const theme of hubThemes()) {
      const before = themeDeclarations(fullRules, theme);
      expect(before, theme).not.toBeNull();
      expect(Object.keys(before!).filter((k) => k.startsWith("--color-")), theme).toHaveLength(20);
      if (theme === "light" || theme === "dark") {
        // From shared-styles.css alone: a light/dark page never loads the rest.
        expect(themeDeclarations(coreRules, theme), theme).toEqual(before);
        expect(themeDeclarations(themesRules, theme), theme).toBeNull();
      } else {
        expect(themeDeclarations(coreRules, theme), theme).toBeNull();
        expect(themeDeclarations(realRules, theme), theme).toEqual(before);
      }
    }
  });

  it("refuses to split a sheet whose themes are not the tail of @layer base", () => {
    const light = "[data-theme=light]{--color-base-100:#fff}";
    const dark = "[data-theme=dark]{--color-base-100:#000}";
    const cupcake = "[data-theme=cupcake]{--color-base-100:#eee}";
    const ok = splitDaisyThemes(
      `@layer theme{:host{--x:1}}@layer base{a{color:red}${light}${dark}${cupcake}}.u{color:blue}`,
    );
    expect(ok.moved).toEqual(["cupcake"]);
    expect(ok.core).toBe(`@layer theme{:host{--x:1}}@layer base{a{color:red}${light}${dark}}.u{color:blue}`);
    expect(ok.themes).toBe(`@layer base{${cupcake}}`);
    // A rule after a moved theme would end up before it.
    expect(() => splitDaisyThemes(`@layer base{${light}${dark}${cupcake}a{color:red}}`)).toThrow();
    // A second base block would hold rules that came after the moved ones.
    expect(() =>
      splitDaisyThemes(`@layer base{${light}${dark}${cupcake}}@layer base{a{color:red}}`),
    ).toThrow();
    // light and dark must stay behind.
    expect(() => splitDaisyThemes(`@layer base{${light}${cupcake}}`)).toThrow();
  });

  it("keeps the widget root ids out of every theme block", () => {
    // v1.10.0 listed the ids in daisyUI's `root`, which put them in front of
    // all 33 built-in theme blocks: an id outranks [data-theme], so every
    // element carrying one got the last block (aqua) whatever its data-theme
    // said. See the comment above `@plugin "daisyui"` in style.css.
    const mentionsId = (sel: string) => ROOT_IDS.some((id) => sel.includes(`#${id}`));
    // Theme blocks only: style.css also has its own #hub-shadow-wrapper rules.
    const themeRules = realRules.filter((r) => /--color-base-100\s*:/.test(r.body));
    expect(themeRules.length).toBeGreaterThan(0);
    expect(themeRules.flatMap((r) => r.selectors).filter(mentionsId)).toEqual([]);
  });

  it("lets #popup-root and #events-shadow-wrapper follow their own data-theme", () => {
    // The cascade for --color-base-100, resolved the way the browser does it:
    // every theme rule whose selector matches the element competes, so exactly
    // one may match, and it must be the rule of the element's data-theme.
    const themeRules = realRules.filter((r) => /--color-base-100\s*:/.test(r.body));
    // The popup links shared-styles.css only, and only ever sets light or dark.
    const coreThemeRules = coreRules.filter((r) => /--color-base-100\s*:/.test(r.body));
    const base100 = (rule: Rule) => /--color-base-100\s*:\s*([^;}]+)/.exec(rule.body)?.[1].trim();
    const ruleOf = (theme: string) =>
      themeRules.find((r) => r.selectors.includes(`[data-theme=${theme}]`));
    const matches = (el: Element, sel: string) => {
      try {
        return el.matches(sel);
      } catch {
        return false; // a selector jsdom cannot parse (:root:has(...)) never names a <div>
      }
    };
    // The popup sets light or dark; the events filter sets the hub preset
    // (synthwave stands for those); aqua is the one the old cascade forced, so
    // it must still apply when it is really the selected theme.
    for (const id of ["popup-root", "events-shadow-wrapper"]) {
      const popup = id === "popup-root";
      for (const theme of popup ? ["light", "dark"] : ["light", "dark", "aqua", "synthwave"]) {
        const el = document.createElement("div");
        el.id = id;
        el.setAttribute("data-theme", theme);
        document.body.appendChild(el);
        const winners = (popup ? coreThemeRules : themeRules).filter((r) =>
          r.selectors.some((s) => matches(el, s)),
        );
        expect(winners, `#${id}[data-theme=${theme}]`).toEqual([ruleOf(theme)]);
        el.remove();
      }
    }
    // The two values the popup switches between really differ.
    expect(base100(ruleOf("light")!)).not.toBe(base100(ruleOf("dark")!));
  });

  it("never renders a daisyUI theme-controller, so its :has() selectors stay dead", () => {
    // Every theme block still carries daisyUI's ":root:has(input.theme-
    // controller[value=x]:checked)" selector. It is harmless only while
    // nothing in src/ renders such an input.
    const users = [...sourceFiles(SRC), POPUP_CONFIG].filter((f) =>
      fs.readFileSync(f, "utf8").includes("theme-controller"),
    );
    expect(users).toEqual([]);
  });
});
