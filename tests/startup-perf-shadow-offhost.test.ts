/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://projects.intra.42.fr/projects/libft" }
 *
 * The logtime widget only mounts on the profile origin: on every other Intra
 * host the perf feature must not look for it at all (it used to poll 20 times).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initPerfStyles, stopPerformance } from "../src/features/performance/perf.ts";

class FakeSheet {
  replaceSync() {}
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  vi.stubGlobal("CSSStyleSheet", FakeSheet);
  (chrome.storage as { onChanged?: unknown }).onChanged ??= {
    addListener: () => {},
    removeListener: () => {},
  };
});

afterEach(() => {
  stopPerformance();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the logtime shadow sheet off the profile origin", () => {
  it("installs neither a timer nor an observer", async () => {
    vi.useFakeTimers();
    const observers: unknown[] = [];
    const Real = MutationObserver;
    vi.stubGlobal(
      "MutationObserver",
      class extends Real {
        constructor(cb: MutationCallback) {
          super(cb);
          observers.push(this);
        }
      },
    );
    await initPerfStyles();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    expect(observers).toHaveLength(0);
  });
});
