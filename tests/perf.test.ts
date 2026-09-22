/**
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HIDDEN_CLASS,
  LAZY_BUDGET,
  PERF_KEYS,
  PERF_SHADOW_TARGETS,
  PERF_STYLE_ID,
  PERF_TARGETS,
  PERF_NEVER_TARGETS,
  PRECONNECT_ORIGINS,
  applyPreconnect,
  buildPerfCss,
  buildShadowPerfCss,
  getImageObserver,
  initPerfObservers,
  initPerfStyles,
  lazifyImages,
  setHiddenClass,
  stopPerformance,
  type PerfFlags,
} from "../src/features/performance/perf";
import { CONFIG_DEFAULT } from "../src/core/config";

const ALL_OFF: PerfFlags = {
  PERF_DEFER_OFFSCREEN: false,
  PERF_LAZY_IMAGES: false,
  PERF_PAUSE_HIDDEN: false,
  PERF_PRECONNECT: false,
};
const ALL_ON: PerfFlags = {
  PERF_DEFER_OFFSCREEN: true,
  PERF_LAZY_IMAGES: true,
  PERF_PAUSE_HIDDEN: true,
  PERF_PRECONNECT: true,
};

/** jsdom gives every element a zero rect; this makes one look on screen. */
function putOnScreen(el: Element, top = 10) {
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + 40,
      left: 0,
      right: 40,
      width: 40,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function setStore(values: Partial<PerfFlags>) {
  return chrome.storage.local.set(values as Record<string, unknown>);
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.classList.remove(HIDDEN_CLASS);
});

afterEach(() => {
  stopPerformance();
  vi.unstubAllGlobals();
});

describe("the four settings exist", () => {
  it("are declared with a default of on", () => {
    for (const key of PERF_KEYS) {
      expect(CONFIG_DEFAULT[key]).toBe(true);
    }
  });
});

describe("buildPerfCss", () => {
  it("emits nothing when every setting is off", () => {
    expect(buildPerfCss(ALL_OFF)).toBe("");
    expect(buildShadowPerfCss(ALL_OFF)).toBe("");
  });

  it("emits the deferral rules only for PERF_DEFER_OFFSCREEN", () => {
    const css = buildPerfCss({ ...ALL_OFF, PERF_DEFER_OFFSCREEN: true });
    expect(css).toContain("@supports (content-visibility: auto)");
    // Firefox < 125 has no content-visibility, and below Tailwind's md the
    // cards are not height-capped, so both guards must be there.
    expect(css).toContain("@media (min-width: 768px)");
    for (const target of PERF_TARGETS) {
      expect(css).toContain(target.selector);
      expect(css).toContain(`contain-intrinsic-size: ${target.size}px;`);
      expect(css).toContain(`contain-intrinsic-size: auto ${target.size}px;`);
    }
    expect(css).not.toContain(HIDDEN_CLASS);
  });

  it("never defers a block that hosts an inline position:fixed tooltip", () => {
    // The pending-evaluation rows render their date-and-time tooltip inside
    // the row; content-visibility would make the row its containing block
    // and clip it (1.12.0 regression, seen on the live dashboard).
    const css = buildPerfCss({ ...ALL_OFF, PERF_DEFER_OFFSCREEN: true });
    for (const never of PERF_NEVER_TARGETS) {
      expect(css).not.toContain(never.selector);
      expect(PERF_TARGETS.some((t) => t.selector === never.selector)).toBe(false);
    }
    expect(css).not.toContain("evaluations");
  });

  it("emits the hidden-tab rule only for PERF_PAUSE_HIDDEN", () => {
    const css = buildPerfCss({ ...ALL_OFF, PERF_PAUSE_HIDDEN: true });
    expect(css).toContain(`html.${HIDDEN_CLASS} body *`);
    expect(css).toContain("animation-play-state: paused !important;");
    expect(css).toContain("transition: none !important;");
    expect(css).not.toContain("content-visibility");
  });

  it("emits the shadow rules only for PERF_DEFER_OFFSCREEN", () => {
    const css = buildShadowPerfCss({ ...ALL_OFF, PERF_DEFER_OFFSCREEN: true });
    for (const target of PERF_SHADOW_TARGETS) {
      expect(css).toContain(target.selector);
    }
    expect(buildShadowPerfCss({ ...ALL_ON, PERF_DEFER_OFFSCREEN: false })).toBe("");
  });

  it("is stable: same input, same text", () => {
    expect(buildPerfCss(ALL_ON)).toBe(buildPerfCss(ALL_ON));
    expect(buildShadowPerfCss(ALL_ON)).toBe(buildShadowPerfCss(ALL_ON));
    // built from constants only: nothing a user can type may appear in it
    expect(buildPerfCss(ALL_ON)).not.toMatch(/undefined|NaN|\[object/);
  });

  it("never targets the profile header, the name or the avatar", () => {
    const css = buildPerfCss(ALL_ON) + buildShadowPerfCss(ALL_ON);
    // AVATAR_SELECTOR / BANNER_SELECTOR / BACKGROUND_SELECTOR of
    // features/profile/selectors.ts must stay out of the deferral rules.
    for (const above of ["rounded-full", "w-52", "h-52", "bg-ft-black", "bg-ft-gray", "header", "h1"]) {
      expect(css).not.toContain(above);
    }
  });
});

describe("lazifyImages", () => {
  it("sets both attributes on an off-screen image", () => {
    const img = document.createElement("img");
    img.src = "https://cdn.intra.42.fr/users/a.jpg";
    document.body.appendChild(img);

    expect(lazifyImages(document.body)).toBe(1);
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("never touches an image that already sets loading", () => {
    const eager = document.createElement("img");
    eager.setAttribute("loading", "eager");
    const lazy = document.createElement("img");
    lazy.setAttribute("loading", "lazy");
    document.body.append(eager, lazy);

    expect(lazifyImages(document.body)).toBe(0);
    expect(eager.getAttribute("loading")).toBe("eager");
    expect(eager.hasAttribute("decoding")).toBe(false);
    expect(lazy.hasAttribute("decoding")).toBe(false);
  });

  it("keeps a decoding value the page already chose", () => {
    const img = document.createElement("img");
    img.setAttribute("decoding", "sync");
    document.body.appendChild(img);

    expect(lazifyImages(document.body)).toBe(1);
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("sync");
  });

  it("never touches images inside our own widgets", () => {
    const hosts = [
      "ft-marks-injected",
      "friends-widget-host",
      "logtime-shadow-wrapper",
      "cluster-shadow-host",
      "better-intra-sort-host",
    ];
    const ours: HTMLImageElement[] = [];
    for (const id of hosts) {
      const host = document.createElement("div");
      host.id = id;
      const img = document.createElement("img");
      host.appendChild(img);
      document.body.appendChild(host);
      ours.push(img);
    }
    // the nav avatar is the page's own <img>, but visuals.ts owns it
    const nav = document.createElement("img");
    nav.dataset.ftNavAvatar = "1";
    document.body.appendChild(nav);

    const theirs = document.createElement("img");
    document.body.appendChild(theirs);

    expect(lazifyImages(document.body)).toBe(1);
    for (const img of [...ours, nav]) {
      expect(img.hasAttribute("loading")).toBe(false);
      expect(img.hasAttribute("decoding")).toBe(false);
    }
    expect(theirs.getAttribute("loading")).toBe("lazy");
  });

  it("never touches images inside a shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const img = document.createElement("img");
    root.appendChild(img);

    expect(lazifyImages(document.body)).toBe(0);
    expect(lazifyImages(root)).toBe(0);
    expect(img.hasAttribute("loading")).toBe(false);
  });

  it("leaves images that are already on screen eager, and does not re-measure them", () => {
    const visible = document.createElement("img");
    const below = document.createElement("img");
    document.body.append(visible, below);
    putOnScreen(visible, 10);

    expect(lazifyImages(document.body)).toBe(1);
    expect(visible.hasAttribute("loading")).toBe(false);
    expect(below.getAttribute("loading")).toBe("lazy");

    // second pass: nothing left to look at
    const spy = vi.fn(visible.getBoundingClientRect.bind(visible));
    visible.getBoundingClientRect = spy;
    expect(lazifyImages(document.body)).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("still lazifies an image far below the fold", () => {
    const img = document.createElement("img");
    document.body.appendChild(img);
    putOnScreen(img, window.innerHeight + 5000);
    expect(lazifyImages(document.body)).toBe(1);
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("stops after its budget", () => {
    for (let i = 0; i < 50; i++) document.body.appendChild(document.createElement("img"));
    expect(lazifyImages(document.body, 10)).toBe(10);
    expect(document.querySelectorAll("img[loading]").length).toBe(10);
    // the rest is picked up by the following passes
    expect(lazifyImages(document.body, 10)).toBe(10);
    expect(document.querySelectorAll("img[loading]").length).toBe(20);
  });

  it("is a no-op without a root", () => {
    expect(lazifyImages(null)).toBe(0);
    expect(lazifyImages(document.body, 0)).toBe(0);
  });
});

describe("preconnect", () => {
  it("adds the hints once and removes only its own", () => {
    const foreign = document.createElement("link");
    foreign.rel = "preconnect";
    foreign.href = "https://example.com";
    document.head.appendChild(foreign);

    applyPreconnect(true);
    const mine = document.head.querySelectorAll("link[data-ft-perf-preconnect]");
    expect(mine.length).toBe(3 * PRECONNECT_ORIGINS.length);
    expect(document.head.querySelector('link[rel="preconnect"][crossorigin]')).not.toBeNull();
    expect(document.head.querySelector('link[rel="dns-prefetch"]')).not.toBeNull();
    for (const link of mine) {
      expect((link as HTMLLinkElement).href).toContain("cdn.intra.42.fr");
    }

    applyPreconnect(true); // idempotent
    expect(document.head.querySelectorAll("link[data-ft-perf-preconnect]").length).toBe(3);

    applyPreconnect(false);
    expect(document.head.querySelectorAll("link[data-ft-perf-preconnect]").length).toBe(0);
    expect(document.head.contains(foreign)).toBe(true);
  });

  it("does not duplicate a hint the Intra already has", () => {
    const own = document.createElement("link");
    own.rel = "preconnect";
    own.href = PRECONNECT_ORIGINS[0];
    document.head.appendChild(own);
    applyPreconnect(true);
    expect(document.head.querySelectorAll("link[data-ft-perf-preconnect]").length).toBe(0);
  });
});

describe("hidden tab", () => {
  it("toggles the namespaced class on <html>", () => {
    setHiddenClass(true);
    expect(document.documentElement.classList.contains(HIDDEN_CLASS)).toBe(true);
    setHiddenClass(false);
    expect(document.documentElement.classList.contains(HIDDEN_CLASS)).toBe(false);
  });

  it("follows visibilitychange once initialised", async () => {
    await setStore(ALL_ON);
    await initPerfStyles();
    expect(document.documentElement.classList.contains(HIDDEN_CLASS)).toBe(false);

    const hide = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    hide("hidden");
    expect(document.documentElement.classList.contains(HIDDEN_CLASS)).toBe(true);
    hide("visible");
    expect(document.documentElement.classList.contains(HIDDEN_CLASS)).toBe(false);
  });
});

describe("init", () => {
  it("installs the stylesheet, the hints and the observer when everything is on", async () => {
    await setStore(ALL_ON);
    const img = document.createElement("img");
    document.body.appendChild(img);

    await initPerfStyles();
    await initPerfObservers();

    const style = document.getElementById(PERF_STYLE_ID);
    expect(style?.textContent).toContain("content-visibility: auto");
    expect(document.head.querySelectorAll("link[data-ft-perf-preconnect]").length).toBe(3);
    expect(getImageObserver()).not.toBeNull();
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("is a complete no-op when the four settings are off", async () => {
    await setStore(ALL_OFF);
    const img = document.createElement("img");
    document.body.appendChild(img);

    await initPerfStyles();
    await initPerfObservers();

    expect(document.getElementById(PERF_STYLE_ID)).toBeNull();
    expect(document.head.querySelectorAll("link[data-ft-perf-preconnect]").length).toBe(0);
    expect(document.documentElement.classList.contains(HIDDEN_CLASS)).toBe(false);
    expect(getImageObserver()).toBeNull();
    expect(img.hasAttribute("loading")).toBe(false);
  });

  it("does not install a second observer on a second init", async () => {
    await setStore(ALL_ON);
    await initPerfObservers();
    const first = getImageObserver();
    expect(first).not.toBeNull();

    await initPerfObservers();
    expect(getImageObserver()).toBe(first);

    // and concurrently, where both calls pass the first guard before awaiting
    stopPerformance();
    await Promise.all([initPerfObservers(), initPerfObservers(), initPerfObservers()]);
    const only = getImageObserver();
    expect(only).not.toBeNull();
    await initPerfObservers();
    expect(getImageObserver()).toBe(only);
  });

  it("stopPerformance disconnects and clears the hidden class", async () => {
    await setStore(ALL_ON);
    await initPerfStyles();
    await initPerfObservers();
    setHiddenClass(true);

    stopPerformance();
    expect(getImageObserver()).toBeNull();
    expect(document.documentElement.classList.contains(HIDDEN_CLASS)).toBe(false);
  });
});

/**
 * A page the size of a real Intra dashboard, to put numbers on the feature.
 *
 * jsdom has no layout and no paint, so what is MEASURED here is only the reach
 * of the two passes: how many <img> elements get the lazy attributes and how
 * many elements the content-visibility rules cover. The rendering saving those
 * two numbers buy is reasoned about in the report, not measured here.
 */
describe("benchmark on an Intra-sized page", () => {
  it("reports how much of the page the feature reaches", () => {
    const IMAGES = 300;
    const ON_SCREEN = 12;

    const wall = document.createElement("div");
    document.body.appendChild(wall);
    for (let i = 0; i < IMAGES; i++) {
      const img = document.createElement("img");
      img.src = `https://cdn.intra.42.fr/users/u${i}.jpg`;
      wall.appendChild(img);
      if (i < ON_SCREEN) putOnScreen(img, i * 60);
    }
    // eight of them belong to our own widgets and must be left alone
    const ourHost = document.createElement("div");
    ourHost.id = "friends-widget-host";
    for (let i = 0; i < 8; i++) ourHost.appendChild(document.createElement("img"));
    document.body.appendChild(ourHost);

    // 400 list rows, built with the classes our own features already read.
    // Each row carries the handful of children a real one has (link, date,
    // score, star span), because what the browser saves is proportional to the
    // nodes inside the deferred block, not to the number of blocks.
    const CHILDREN_PER_ROW = 6;
    const mk = (parent: Element, n: number, cls: string) => {
      for (let i = 0; i < n; i++) {
        const row = document.createElement("div");
        row.className = cls;
        for (let c = 0; c < CHILDREN_PER_ROW; c++) {
          const child = document.createElement("span");
          child.textContent = `cell ${c}`;
          row.appendChild(child);
        }
        parent.appendChild(row);
      }
    };
    const marks = document.createElement("div");
    marks.id = "ft-marks-injected";
    mk(marks, 150, "flex flex-row justify-between hover:bg-gray-300 py-1 px-2");
    const native = document.createElement("div");
    mk(native, 100, "flex flex-row justify-between hover:bg-gray-300 p-2");
    const achievements = document.createElement("div");
    achievements.dataset.ftCard = "achievements";
    const grid = document.createElement("div");
    grid.className = "grid";
    achievements.appendChild(grid);
    mk(grid, 100, "w-full h-24");
    const evals = document.createElement("div");
    evals.dataset.ftCard = "evaluations";
    mk(evals, 50, "flex justify-between w-full items-center");
    document.body.append(marks, native, achievements, evals);

    // ---- measure ----
    let lazified = 0;
    let passes = 0;
    // the observer runs the same bounded pass until the page is exhausted
    for (let n = lazifyImages(document.body); n > 0; n = lazifyImages(document.body)) {
      lazified += n;
      passes++;
    }

    // A deferred block costs the browser nothing while it is off screen, so
    // the useful number is the DOM weight inside the covered blocks, not the
    // number of blocks.
    const totalNodes = document.body.querySelectorAll("*").length;
    let covered = 0;
    let coveredNodes = 0;
    const perTarget: Record<string, string> = {};
    for (const t of PERF_TARGETS) {
      const hits = document.querySelectorAll(t.selector);
      let nodes = 0;
      for (const el of hits) nodes += 1 + el.querySelectorAll("*").length;
      perTarget[t.selector] = `${String(hits.length).padStart(3)} blocks / ${String(nodes).padStart(4)} nodes`;
      covered += hits.length;
      coveredNodes += nodes;
    }
    const pct = ((coveredNodes / totalNodes) * 100).toFixed(1);

    console.log(
      [
        "",
        "  Better Intra - Lighten the Intra, synthetic jsdom page",
        "  ---------------------------------------------------------------",
        `  images on the page ............ ${IMAGES + 8} (${IMAGES} the Intra's, 8 ours)`,
        `  lazified ...................... ${lazified} in ${passes} pass(es) of ${LAZY_BUDGET}`,
        `  left eager (on screen) ........ ${document.querySelectorAll("img[data-ft-perf]").length}`,
        `  ours, untouched ............... ${ourHost.querySelectorAll("img:not([loading])").length}`,
        `  list rows on the page ......... ${covered}`,
        `  elements in <body> ............ ${totalNodes}`,
        `  inside a deferred block ....... ${coveredNodes}  (${pct}% of the page)`,
        ...Object.entries(perTarget).map(([sel, n]) => `      ${n}  ${sel}`),
        "  measured: reach of the two passes. Not measured: paint and layout",
        "  time - jsdom has neither.",
        "",
      ].join("\n"),
    );

    expect(lazified).toBe(IMAGES - ON_SCREEN);
    expect(passes).toBe(Math.ceil((IMAGES - ON_SCREEN) / LAZY_BUDGET));
    expect(ourHost.querySelectorAll("img:not([loading])").length).toBe(8);
    // 150 + 100 + 100: the 50 evaluation rows are on purpose left out
    expect(covered).toBe(350);
    // the rows are the bulk of the page: that is the point of the feature
    expect(coveredNodes / totalNodes).toBeGreaterThan(0.6);
  });
});

