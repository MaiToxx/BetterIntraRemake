import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * shared-styles.ts is a page-wide singleton: one fetch, one parsed sheet, one
 * <link> fallback policy. Every case therefore installs its own chrome / fetch
 * / CSSStyleSheet stubs and re-imports the module with a clean registry, so the
 * memoisation under test is the one this case created.
 */

const CSS_FILE = "shared-styles.css";
const CSS_URL = `chrome-extension://better-intra/${CSS_FILE}`;
const CSS_TEXT = ":host{display:block}";

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

function installFetch(impl: () => Promise<unknown>) {
  const mock = vi.fn(impl);
  (globalThis as Record<string, unknown>).fetch = mock;
  return mock;
}

function okResponse() {
  return Promise.resolve({ ok: true, text: () => Promise.resolve(CSS_TEXT) });
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

describe("shared-styles.css contents", () => {
  let styleCss = "";
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
    realRules = rulesOf(realCss);
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
    const themes = Object.keys(
      JSON.parse(
        fs.readFileSync(path.join(SRC, "core/theme/themes.json"), "utf8"),
      ) as Record<string, unknown>,
    );
    expect(themes).toHaveLength(36);
    const selectorText = [...real].join("\n");
    for (const theme of themes) expect(selectorText).toContain(`[data-theme=${theme}]`);
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
      for (const theme of ["light", "dark", "aqua", "synthwave"]) {
        const el = document.createElement("div");
        el.id = id;
        el.setAttribute("data-theme", theme);
        document.body.appendChild(el);
        const winners = themeRules.filter((r) => r.selectors.some((s) => matches(el, s)));
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
