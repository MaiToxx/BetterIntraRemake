/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * Shortcuts watched the whole page for the tab's life on every Intra host,
 * and with the default settings (no link) it narrowed the Intra's "important
 * links" block to 50% and widened it back on every DOM change. It now watches
 * only when it has something to put back after a re-render: links to show,
 * or the block to hide.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nothing } from "lit-html";

vi.mock("../src/core/styles/shared-styles.ts", () => ({
  sharedStylesLink: () => nothing,
}));

import { initShortcuts } from "../src/features/shortcuts/shortcuts.ts";

type Listener = (changes: Record<string, unknown>, area: string) => void;
const storageListeners = new Set<Listener>();
const observers: MutationObserver[] = [];

const LINK = { name: "Docs", url: "https://docs.example.com", color: "#7dd3fc", emoji: "" };

/** The profile-v3 banner the pass works on. */
function mountBanner(): HTMLElement {
  document.getElementById("banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "banner";
  banner.className = "w-full flex flex-row gap-8 py-4 px-8 items-center";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "hidden lg:block");
  const info = document.createElement("div");
  info.className = "flex flex-col text-sm w-full gap-1";
  info.textContent = "Important links";
  banner.append(icon, info);
  document.body.appendChild(banner);
  return info;
}

async function settle(ms = 0) {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  if (ms) await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function changeSetting(values: Record<string, unknown>) {
  await chrome.storage.local.set(values);
  const changes = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, { newValue: v }]),
  );
  for (const fn of [...storageListeners]) fn(changes, "local");
  await settle();
}

beforeEach(async () => {
  vi.useFakeTimers();
  await chrome.storage.local.clear();
  document.body.replaceChildren();
  observers.length = 0;
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
  (chrome.storage as { onChanged?: unknown }).onChanged = {
    addListener: (fn: Listener) => storageListeners.add(fn),
    removeListener: (fn: Listener) => storageListeners.delete(fn),
  };
});

afterEach(() => {
  // disconnects the observer and forgets it, for the next case
  window.dispatchEvent(new Event("pagehide"));
  storageListeners.clear();
  delete (chrome.storage as { onChanged?: unknown }).onChanged;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("shortcuts on profile-v3", () => {
  it("installs no observer and leaves the Intra's block untouched by default", async () => {
    const info = mountBanner();
    await initShortcuts();
    await settle(1000);
    expect(observers).toHaveLength(0);
    expect(info.getAttribute("style")).toBeNull();
    expect(info.classList.contains("w-full")).toBe(true);
    expect(document.getElementById("shortcuts-shadow-wrapper")).toBeNull();
  });

  it("with Hide important links and no link, hides the block again after a re-render", async () => {
    await chrome.storage.local.set({ SHORTCUTS_HIDE_IMPORTANT_LINKS: true });
    const first = mountBanner();
    await initShortcuts();
    expect(first.style.display).toBe("none");
    expect(observers).toHaveLength(1);
    const second = mountBanner(); // profile-v3 re-renders the banner
    expect(second.style.display).toBe("");
    await settle(350);
    expect(second.style.display).toBe("none");
  });

  it("shows the links and puts them back after a re-render", async () => {
    await chrome.storage.local.set({ SHORTCUTS_LINKS: [LINK] });
    const info = mountBanner();
    await initShortcuts();
    expect(document.getElementById("shortcuts-shadow-wrapper")).not.toBeNull();
    expect(info.style.width).toBe("50%");
    mountBanner();
    expect(document.getElementById("shortcuts-shadow-wrapper")).toBeNull();
    await settle(350);
    expect(document.getElementById("shortcuts-shadow-wrapper")).not.toBeNull();
  });

  it("starts watching once a link is added, without a reload", async () => {
    mountBanner();
    await initShortcuts();
    expect(observers).toHaveLength(0);
    await changeSetting({ SHORTCUTS_ALIGNMENT: "center" }); // not one that gives work
    expect(observers).toHaveLength(0);
    await changeSetting({ SHORTCUTS_LINKS: [LINK] });
    expect(observers).toHaveLength(1);
    expect(document.getElementById("shortcuts-shadow-wrapper")).not.toBeNull();
    expect(storageListeners.size).toBe(0);
  });
});
