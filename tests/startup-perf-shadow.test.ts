/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The perf sheet for the logtime widget's shadow root. adoptShadowCss() used to
 * poll for `#logtime-shadow-wrapper` every 500 ms, 20 times, on every Intra
 * page (the widget only ever mounts on the profile origin). It now waits on
 * one observer with a deadline, and adopts the sheet the moment the host lands.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initPerfStyles, stopPerformance } from "../src/features/performance/perf.ts";

/** jsdom has neither constructable stylesheets nor adoptedStyleSheets. */
class FakeSheet {
  css = "";
  replaceSync(css: string) {
    this.css = css;
  }
}

const flush = async (times = 8) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

const mountLogtimeHost = () => {
  const host = document.createElement("div");
  host.id = "logtime-shadow-wrapper";
  const root = host.attachShadow({ mode: "open" });
  (root as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets = [];
  document.body.appendChild(host);
  return root as ShadowRoot & { adoptedStyleSheets: unknown[] };
};

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.stubGlobal("CSSStyleSheet", FakeSheet);
  (chrome.storage as { onChanged?: unknown }).onChanged ??= {
    addListener: () => {},
    removeListener: () => {},
  };
});

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  stopPerformance();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the logtime shadow sheet", () => {
  it("is adopted when the widget mounts later, with no timer left behind", async () => {
    vi.useFakeTimers();
    await initPerfStyles();
    await flush();

    const root = mountLogtimeHost();
    await flush();
    // Before: nothing until the next 500 ms tick.
    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect((root.adoptedStyleSheets[0] as FakeSheet).css).toContain(
      "content-visibility",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("costs one wake-up over 10 s on a dashboard without the widget (it was 20)", async () => {
    vi.useFakeTimers();
    let fired = 0;
    const realSetTimeout = setTimeout;
    vi.stubGlobal(
      "setTimeout",
      (fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
        realSetTimeout(
          (...a: unknown[]) => {
            fired++;
            fn(...a);
          },
          ms,
          ...rest,
        ),
    );
    await initPerfStyles();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fired).toBeLessThanOrEqual(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
