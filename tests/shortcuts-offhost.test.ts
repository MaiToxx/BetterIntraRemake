/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://projects.intra.42.fr/projects/libft" }
 *
 * The "important links" banner exists on profile-v3 only: everywhere else
 * Shortcuts used to watch the whole page for the tab's life, for nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { initShortcuts } from "../src/features/shortcuts/shortcuts.ts";

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shortcuts off profile-v3", () => {
  it("installs neither an observer nor a timer, even with links set", async () => {
    await chrome.storage.local.set({
      SHORTCUTS_LINKS: [{ name: "Docs", url: "https://docs.example.com", color: "#7dd3fc" }],
    });
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
    await initShortcuts();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(observers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
