import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  return await import("../src/assets/shared-styles.ts");
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
