/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://projects.intra.42.fr/projects" }
 *
 * The seat highlight starts on every Intra page (highlight.ts runs at import).
 * With no campus detected yet it used to call getClusterData(""), which probes
 * every campus file and loads the first one (Paris) into the shared cluster
 * list, on every page: the cluster pickers then listed Paris's clusters, and
 * the real campus was never loaded on the page that detected it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const flush = () => new Promise((r) => setTimeout(r, 0));

async function importHighlight() {
  vi.resetModules();
  await import("../src/features/profile/layout/highlight.ts");
  // init() awaits the campus data before it installs its stylesheet.
  await vi.waitFor(() => expect(document.getElementById("ft-glow-styles")).not.toBeNull());
  return import("../src/features/campus/campus.ts");
}

beforeEach(async () => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  await chrome.storage.local.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/campuses.json")) {
        return new Response(JSON.stringify({ campuses: [{ id: "1", name: "Paris" }] }));
      }
      return new Response(JSON.stringify({ clusters: [{ id: "315", name: "f0" }] }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("seat highlight start-up", () => {
  it("probes no campus file and loads no clusters while the campus is unknown", async () => {
    const campus = await importHighlight();
    await flush();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(campus.CLUSTERS).toHaveLength(0);
    const stored = await chrome.storage.local.get(null);
    expect(Object.keys(stored).filter((k) => k.startsWith("CAMPUS_DATA_"))).toEqual([]);
  });

  it("loads the known campus from its cache", async () => {
    await chrome.storage.local.set({
      CLUSTERS_CAMPUS: "7",
      CAMPUS_DATA_7: { data: { clusters: [{ id: "k0", name: "k0" }] }, timestamp: Date.now() },
    });
    const campus = await importHighlight();
    expect(campus.CLUSTERS.map((c) => c.name)).toEqual(["k0"]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("scans nothing on a click when no seat was ever highlighted", async () => {
    await importHighlight();
    const scan = vi.spyOn(document, "querySelectorAll");
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    expect(scan.mock.calls.some(([sel]) => String(sel).includes("data-highlighted"))).toBe(false);
    scan.mockRestore();
  });
});
