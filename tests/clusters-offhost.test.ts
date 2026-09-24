/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://projects.intra.42.fr/projects/libft" }
 *
 * The cluster picker, the chair markers and "Open profiles in new tab" are for
 * meta.intra.42.fr. initClusters() used to run all of it on every Intra host:
 * a 30 s DOM watcher, an observer left on the page's first icon, and a capture
 * click handler that sent every profile link to a new tab.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const campus = vi.hoisted(() => ({ ensureCampusData: vi.fn(async () => {}) }));
vi.mock("../src/features/campus/campus.ts", () => ({
  CLUSTERS: [] as unknown[],
  ensureCampusData: campus.ensureCampusData,
  fetchCampusList: async () => ({ campuses: [] }),
  loadCampusData: async () => ({ clusters: [], definitions: {} }),
}));

const { initClusters } = await import("../src/features/clusters/clusters.ts");

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLUSTERS_OPEN_NEW_TAB: true, CLUSTERS_CAMPUS: "1" });
});

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("initClusters off meta.intra.42.fr", () => {
  it("installs no observer, no timer and no campus load", async () => {
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
    // an icon, as on every Intra v3 page: it used to be observed for good
    document.body.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    await initClusters();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(observers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(campus.ensureCampusData).not.toHaveBeenCalled();
  });

  it("leaves profile links alone, even with Open profiles in new tab on", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await initClusters();
    const link = document.createElement("a");
    link.href = "https://profile.intra.42.fr/users/bob";
    document.body.appendChild(link);
    let reached = false;
    link.addEventListener("click", (e) => {
      reached = true;
      e.preventDefault(); // jsdom would try to navigate
    });
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(reached).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});
