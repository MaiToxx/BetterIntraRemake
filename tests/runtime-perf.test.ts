/**
 * Pins the start-up cost of the content script: how many storage round-trips
 * a feature needs before the page is interactive, how many timers it leaves
 * behind, and how much forced layout a profile pass costs.
 *
 * These are regression guards, not micro-benchmarks: each number below used to
 * be several times higher, and the point is that it stays where it is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { waitForElement, watchDom } from "../src/core/dom/dom-wait.ts";
import { hasIntraMutation } from "../src/features/profile/profile.ts";
import { ensureCampusData } from "../src/features/campus/campus.ts";
import { initHubSettings } from "../src/features/hub/hubSettings.ts";
import { updateVisuals } from "../src/features/profile/header/visuals.ts";

const getCalls = () => vi.mocked(chrome.storage.local.get).mock.calls.length;

/** How many of those round-trips asked for a given key. */
const readsOf = (key: string) =>
  vi.mocked(chrome.storage.local.get).mock.calls.filter(([keys]) =>
    Array.isArray(keys) ? keys.includes(key) : keys === key,
  ).length;

// The shared mock only provides storage.local; several modules subscribe to
// storage.onChanged at start-up, so give them a listener registry here rather
// than in the shared setup another suite may be editing.
const changeListeners: ((
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void)[] = [];
(chrome.storage as { onChanged?: unknown }).onChanged ??= {
  addListener: (fn: (typeof changeListeners)[number]) =>
    changeListeners.push(fn),
  removeListener: () => {},
};

/** Let pending microtasks (observer callbacks, awaited promises) run. */
const flush = async (times = 4) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

beforeEach(async () => {
  await (chrome.storage.local.clear as () => Promise<void>)();
  vi.mocked(chrome.storage.local.get).mockClear();
  document.body.replaceChildren();
  document.head.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  window.dispatchEvent(new Event("pagehide"));
});

describe("waitForElement", () => {
  it("resolves synchronously when the element is already there", async () => {
    const el = document.createElement("div");
    el.id = "target";
    document.body.appendChild(el);
    await expect(waitForElement("#target")).resolves.toBe(el);
  });

  it("resolves on the mutation, without a single timer tick", async () => {
    vi.useFakeTimers();
    const promise = waitForElement("#late", { timeoutMs: 5000 });

    const el = document.createElement("div");
    el.id = "late";
    document.body.appendChild(el);

    // No advanceTimersByTime(): the old 250 ms poll could not do this.
    await flush(8);
    await expect(promise).resolves.toBe(el);
  });

  it("gives up at the deadline and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const promise = waitForElement("#never", { timeoutMs: 1000 });
    expect(vi.getTimerCount()).toBe(1); // the deadline, and nothing else
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops on pagehide", async () => {
    vi.useFakeTimers();
    const promise = waitForElement("#never", { timeoutMs: 60000 });
    window.dispatchEvent(new Event("pagehide"));
    await expect(promise).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("watchDom", () => {
  it("runs once per burst instead of on a fixed tick", async () => {
    vi.useFakeTimers();
    const seen = vi.fn(() => false);
    watchDom(seen, { timeoutMs: 10000 });
    expect(seen).toHaveBeenCalledTimes(1); // immediate run

    // Ten seconds of a quiet page: the old 500 ms poll ran 20 times.
    vi.advanceTimersByTime(9000);
    expect(seen).toHaveBeenCalledTimes(1);

    document.body.appendChild(document.createElement("div"));
    await flush();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("stops itself once the callback reports it is done", async () => {
    const seen = vi.fn(() => true);
    watchDom(seen);
    document.body.appendChild(document.createElement("div"));
    await flush();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer running after pagehide", () => {
    vi.useFakeTimers();
    watchDom(() => false, { timeoutMs: 30000 });
    expect(vi.getTimerCount()).toBe(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("profile pass scheduling", () => {
  const record = (init: Partial<MutationRecord>): MutationRecord =>
    ({
      type: "childList",
      target: document.body,
      addedNodes: document.createDocumentFragment().childNodes,
      removedNodes: document.createDocumentFragment().childNodes,
      ...init,
    }) as MutationRecord;

  const nodesOf = (...els: Element[]): NodeList => {
    const frag = document.createDocumentFragment();
    els.forEach((el) => frag.appendChild(el));
    return frag.childNodes;
  };

  const withId = (id: string) => {
    const el = document.createElement("div");
    el.id = id;
    return el;
  };

  it("ignores a burst that only injects our own nodes", () => {
    const records = [
      record({ addedNodes: nodesOf(withId("ft-marks-injected")) }),
      record({ addedNodes: nodesOf(withId("friends-widget-host")) }),
    ];
    expect(hasIntraMutation(records)).toBe(false);
  });

  it("ignores the tooltip appearing and disappearing", () => {
    const tip = withId("ft-floating-tooltip");
    expect(hasIntraMutation([record({ addedNodes: nodesOf(tip) })])).toBe(
      false,
    );
    expect(hasIntraMutation([record({ removedNodes: nodesOf(tip) })])).toBe(
      false,
    );
  });

  it("ignores lit-html re-rendering inside one of our hosts", () => {
    const host = withId("logtime-shadow-wrapper");
    document.body.appendChild(host);
    expect(
      hasIntraMutation([
        record({
          target: host,
          addedNodes: nodesOf(document.createElement("span")),
        }),
      ]),
    ).toBe(false);
  });

  it("still schedules a pass for anything the React app does", () => {
    expect(
      hasIntraMutation([
        record({ addedNodes: nodesOf(document.createElement("section")) }),
      ]),
    ).toBe(true);
    // A removal of one of our mounted widgets must re-mount it.
    expect(
      hasIntraMutation([
        record({ removedNodes: nodesOf(withId("ft-marks-injected")) }),
      ]),
    ).toBe(true);
    // Mixed burst: one Intra node is enough.
    expect(
      hasIntraMutation([
        record({
          addedNodes: nodesOf(
            withId("ft-marks-injected"),
            document.createElement("li"),
          ),
        }),
      ]),
    ).toBe(true);
  });

  it("bounds the work it does per burst", () => {
    // A very large burst is answered without looking at it: above 64 records
    // the page is certainly rendering, and walking them all would be the kind
    // of per-burst cost this whole change is removing.
    const many = Array.from({ length: 5000 }, () =>
      record({ addedNodes: nodesOf(withId("ft-marks-injected")) }),
    );
    const started = performance.now();
    expect(hasIntraMutation(many)).toBe(true);
    expect(performance.now() - started).toBeLessThan(5);

    // A burst it does inspect walks at most 24 ancestors per node.
    let deep = document.createElement("div");
    document.body.appendChild(deep);
    for (let i = 0; i < 60; i++) {
      const child = document.createElement("div");
      deep.appendChild(child);
      deep = child;
    }
    const nested = Array.from({ length: 64 }, () =>
      record({ target: deep, addedNodes: nodesOf(document.createElement("i")) }),
    );
    const t0 = performance.now();
    expect(hasIntraMutation(nested)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(10);
  });
});

describe("ensureCampusData", () => {
  it("reads the campus id once for every start-up caller", async () => {
    // main.ts, profile.ts and clusters.ts all call it, concurrently and then
    // again later: one storage round-trip for the lot (it used to be three).
    await Promise.all([
      ensureCampusData(),
      ensureCampusData(),
      ensureCampusData(),
    ]);
    // At most one: when a read started by module start-up (shared styles now
    // read the theme preset at import) is still in flight, the three callers
    // join it and this test sees zero new reads. Load-dependent, and both
    // outcomes honour the invariant: never more than one read for the lot.
    const first = getCalls();
    expect(first).toBeLessThanOrEqual(1);

    await ensureCampusData();
    await ensureCampusData();
    expect(getCalls()).toBe(first);
  });
});

describe("a profile visual pass", () => {
  const mount = () => {
    const avatar = document.createElement("div");
    avatar.className = "rounded-full w-52 h-52";
    const banner = document.createElement("div");
    banner.className = "border-neutral-600 bg-ft-gray/50";
    const background = document.createElement("div");
    background.className = "w-full xl:h-72 bg-center bg-cover bg-ft-black";
    document.body.append(avatar, banner, background);
    return { avatar, banner, background };
  };

  it("forces no style recalculation once the visuals are applied", async () => {
    mount();
    await chrome.storage.local.set({
      PROFILE_IMAGE_URL: "https://cdn.example.com/avatar.png",
      PROFILE_BANNER_URL: "https://cdn.example.com/banner.png",
      PROFILE_BACKGROUND_URL: "https://cdn.example.com/bg.png",
    });

    await updateVisuals();

    // Second pass on an unchanged DOM: no getComputedStyle (it used to read
    // the computed background of the avatar, the banner and the background,
    // i.e. three forced style recalculations per mutation burst) and no
    // second read of the login (cached for the page).
    const computed = vi.spyOn(window, "getComputedStyle");
    vi.mocked(chrome.storage.local.get).mockClear();

    await updateVisuals();

    expect(computed).toHaveBeenCalledTimes(0);
    expect(readsOf("CLOUD_LOGIN")).toBe(0);
    // The visuals themselves are cached too: no re-read of the 13 PROFILE_*
    // keys, which is what the batched getConfigMany() costs.
    expect(readsOf("PROFILE_IMAGE_URL")).toBe(0);
    computed.mockRestore();
  });

  it("the previous check cost three style recalculations for that same DOM", () => {
    // Baseline the "0" above is measured against, replicated here the way
    // tests/visuals.test.ts already replicates hasBackground(): the old helper
    // always read the computed style, for the avatar, the banner and the
    // background element.
    const { avatar, banner, background } = mount();
    const urlRe = /url\((["']?)(.*?)\1\)/;
    const oldHasBackground = (el: HTMLElement, url: string) => {
      const inline = el.style.backgroundImage || "";
      const computed = window.getComputedStyle(el).backgroundImage || "";
      return inline.match(urlRe)?.[2] === url || computed.match(urlRe)?.[2] === url;
    };

    const computed = vi.spyOn(window, "getComputedStyle");
    oldHasBackground(avatar, "https://cdn.example.com/avatar.png");
    oldHasBackground(banner, "https://cdn.example.com/banner.png");
    oldHasBackground(background, "https://cdn.example.com/bg.png");
    expect(computed).toHaveBeenCalledTimes(3);
    computed.mockRestore();
  });

  it("does not re-apply the visuals when nothing changed", async () => {
    const { avatar } = mount();
    await chrome.storage.local.set({
      PROFILE_IMAGE_URL: "https://cdn.example.com/avatar.png",
    });
    await updateVisuals();

    // A sentinel applyImgs() would overwrite with the configured avatar
    // background. needsReapply() used to always answer "yes" because it
    // expected an empty badge <style> that applyImgs never writes.
    avatar.style.setProperty("background-color", "rgb(1, 2, 3)", "important");
    await updateVisuals();
    expect(avatar.style.backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("re-applies when React hands us a fresh avatar element", async () => {
    const { avatar } = mount();
    await chrome.storage.local.set({
      PROFILE_IMAGE_URL: "https://cdn.example.com/avatar.png",
    });
    await updateVisuals();
    expect(avatar.style.opacity).toBe("1");

    // injectCustomStyles() hides every avatar until we reveal it, so a
    // re-rendered one must be picked up even though the cached key is the same.
    const fresh = document.createElement("div");
    fresh.className = "rounded-full w-52 h-52";
    avatar.replaceWith(fresh);

    await updateVisuals();
    expect(fresh.style.opacity).toBe("1");
    expect(fresh.style.backgroundImage).toContain("avatar.png");
  });
});

describe("initHubSettings", () => {
  it("mounts the sidebar without polling and stops on pagehide", async () => {
    vi.useFakeTimers();
    await initHubSettings();
    await flush();

    // getActiveFeatures() + CLUSTERS_CAMPUS: the 500 ms x 20 poll used to add
    // one CLUSTERS_CAMPUS read per tick.
    const afterInit = getCalls();
    expect(afterInit).toBeLessThanOrEqual(2);

    vi.advanceTimersByTime(10000);
    await flush();
    expect(getCalls()).toBe(afterInit);

    window.dispatchEvent(new Event("pagehide"));
    expect(vi.getTimerCount()).toBe(0);
  });
});
