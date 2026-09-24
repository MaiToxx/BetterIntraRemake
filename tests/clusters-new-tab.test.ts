/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://meta.intra.42.fr/clusters" }
 *
 * "Open profiles in new tab" on the Intra's own cluster page: a plain click on
 * a student opens their profile in a new tab, without handing the Intra page
 * a reference to it; a modified click is left to the browser (Ctrl/Cmd for a
 * background tab, Shift for a window) instead of becoming a foreground tab.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";

vi.mock("../src/features/campus/campus.ts", () => ({
  CLUSTERS: [] as unknown[],
  ensureCampusData: async () => {},
  fetchCampusList: async () => ({ campuses: [] }),
  loadCampusData: async () => ({ clusters: [], definitions: {} }),
}));

const { initClusters } = await import("../src/features/clusters/clusters.ts");

const open = vi.fn();

// Once, as on a page: the click listener lives for the page's life, so
// starting it again for every case would stack one more listener each time.
beforeAll(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLUSTERS_OPEN_NEW_TAB: true });
  await initClusters();
});

afterAll(() => {
  window.dispatchEvent(new Event("pagehide"));
});

beforeEach(() => {
  open.mockClear();
  vi.stubGlobal("open", open);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function clickProfile(init: MouseEventInit = {}): MouseEvent {
  const link = document.createElement("a");
  link.href = "https://profile.intra.42.fr/users/bob";
  document.body.appendChild(link);
  // jsdom would otherwise try to navigate on the default action
  link.addEventListener("click", (e) => e.preventDefault());
  const e = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  link.dispatchEvent(e);
  return e;
}

describe("Open profiles in new tab on meta.intra.42.fr", () => {
  it("opens a plain click in a new tab, with noopener", () => {
    clickProfile();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://profile.intra.42.fr/users/bob", "_blank", "noopener");
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    "leaves a modified or non-primary click to the browser (%o)",
    (mods) => {
      clickProfile(mods);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("opens a seat's student from the map image, with noopener", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttribute("data-tooltip-login", "alice");
    svg.appendChild(image);
    document.body.appendChild(svg);
    image.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://profile.intra.42.fr/users/alice", "_blank", "noopener");
  });
});
