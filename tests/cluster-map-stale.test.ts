/**
 * The cluster map while the worker (or meta.intra.42.fr) fails: the last map
 * and the last cluster list are shown instead of an empty dialog, and an
 * expired map is never saved back as fresh.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ensureClusterData } from "../src/features/clusters/map-dialog/map-load";
import {
  getCachedCluster,
  scrapeCampusSVGUrls,
} from "../src/features/clusters/map-dialog/cache";
import type { DialogState } from "../src/features/clusters/map-dialog/context";

const DAY = 24 * 60 * 60 * 1000;
const OLD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"></svg>';
const NEW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"></svg>';

let reply: "down" | "offline" | "up";

function state(): DialogState {
  return {
    seatPosCache: new Map(),
    svgViewBoxes: new Map(),
    parsedDocs: new Map(),
  } as unknown as DialogState;
}

async function seedMap(ageMs: number) {
  await chrome.storage.local.set({
    cluster_svg_7_k0: JSON.stringify({
      svg: OLD_SVG,
      seats: [],
      viewBox: { w: 10, h: 20 },
      cachedAt: Date.now() - ageMs,
    }),
  });
}

const cluster = () => ({ id: "k0", name: "", svg: "https://cdn.intra.42.fr/cluster/image/1/k0.svg" });

beforeEach(async () => {
  await chrome.storage.local.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (reply === "offline") throw new TypeError("NetworkError");
      if (reply === "down") return new Response("", { status: 503 });
      if (String(url).includes("meta.intra.42.fr")) {
        return new Response(
          '<div class="tab-pane" id="cluster-k1"><div class="map-container" data-image="/k1.svg"></div></div>',
          { status: 200 },
        );
      }
      return new Response(NEW_SVG, { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("cluster map, worker failing", () => {
  it.each(["down", "offline"] as const)("shows last week's map (%s)", async (r) => {
    reply = r;
    await seedMap(10 * DAY);
    const s = state();
    expect(await ensureClusterData(s, cluster(), "7")).toBe(OLD_SVG);
    expect(s.svgViewBoxes.get("7:k0")).toEqual({ w: 10, h: 20 });
    // still expired: the next open asks the worker again
    expect(await getCachedCluster("7", "k0")).toBeNull();
  });

  it("with nothing cached, gives up as before", async () => {
    reply = "down";
    expect(await ensureClusterData(state(), cluster(), "7")).toBeNull();
  });

  it("prefers the worker's map over an expired one", async () => {
    reply = "up";
    await seedMap(10 * DAY);
    expect(await ensureClusterData(state(), cluster(), "7")).toBe(NEW_SVG);
    expect((await getCachedCluster("7", "k0"))?.svg).toBe(NEW_SVG);
  });
});

describe("cluster list, meta.intra.42.fr failing", () => {
  async function seedUrls(ageMs: number) {
    await chrome.storage.local.set({
      CLUSTER_SVG_URLS_V1_7: {
        data: { k0: "https://cdn.intra.42.fr/k0.svg" },
        cachedAt: Date.now() - ageMs,
      },
    });
  }

  it.each(["down", "offline"] as const)("serves the expired list (%s)", async (r) => {
    reply = r;
    await seedUrls(10 * DAY);
    expect(await scrapeCampusSVGUrls("7")).toEqual({ k0: "https://cdn.intra.42.fr/k0.svg" });
  });

  it("replaces an expired list when the page answers", async () => {
    reply = "up";
    await seedUrls(10 * DAY);
    expect(await scrapeCampusSVGUrls("7")).toEqual({ k1: "https://meta.intra.42.fr/k1.svg" });
  });

  it("still returns nothing when nothing was ever cached", async () => {
    reply = "down";
    expect(await scrapeCampusSVGUrls("7")).toEqual({});
  });
});
