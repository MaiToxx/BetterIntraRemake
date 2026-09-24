import { getConfigMany } from "../../core/config.ts";
import {
  applyManualScreens,
  applyMarkersVisibility,
  getClusterTabsList,
  injectUI,
} from "./dom.ts";
import { createShadowUI } from "./ui.ts";
import { ensureCampusData } from "../campus/campus.ts";
import { getClusterData } from "./clusters.data.ts";
import { waitForElement, watchDom } from "../../core/dom/dom-wait.ts";

type Config = {
  show_markers: boolean;
  default_id: string;
};

/** Same budget as the old 500 ms x 60 poll. */
const MAP_WATCH_MS = 30000;
/** Same budget as the old 100 ms x 30 poll. */
const CLUSTER_TAB_WAIT_MS = 3000;
/** The Intra's own cluster pages, the only place this feature has work. */
const CLUSTER_PAGE_HOST = "meta.intra.42.fr";

export async function initClusters() {
  "use strict";

  // The picker, the chair markers and "Open profiles in new tab" are for the
  // Intra's cluster page. This ran on every Intra host: a 30 s DOM watcher
  // for a picker that never mounts, an observer left on the page's first
  // icon for the tab's life, and a capture click handler that turned every
  // profile link (the v3 sidebar's Settings, team members on projects) into
  // a new tab for anyone with the setting on.
  if (location.hostname !== CLUSTER_PAGE_HOST) return;

  let CONFIG: Config;
  let refreshQueued = false;
  let svgObserver: MutationObserver | null = null;
  let observedSvgRoot: SVGSVGElement | null = null;

  function refreshMarkersSoon() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      applyManualScreens(CONFIG.show_markers);
      applyMarkersVisibility(CONFIG.show_markers);
      refreshQueued = false;
    });
  }

  const handleClusterChange = async (value: string) => {
    await chrome.storage.local.set({ CLUSTERS_DEFAULT_ID: value });
    CONFIG.default_id = value;
    window.location.hash = `#cluster-${value}`;

    const nativeTab = document.querySelector<HTMLAnchorElement>(
      `a[href="#cluster-${value}"]`,
    );
    if (nativeTab) nativeTab.click();

    reRenderUI();
  };

  const handleMarkerToggle = async () => {
    CONFIG.show_markers = !CONFIG.show_markers;
    await chrome.storage.local.set({
      CLUSTERS_SHOW_MARKERS: CONFIG.show_markers,
    });
    reRenderUI();
    refreshMarkersSoon();
  };

  // The picker lives in a shadow root that carries the whole Tailwind/daisyUI
  // sheet (~300 KB). meta.intra.42.fr has other pages than the cluster map, so
  // it is only built once the page really has a cluster tab list to mount in.
  let shadowHost: HTMLElement | null = null;
  let reRender:
    | ((currentId: string, showMarkers: boolean) => void)
    | null = null;

  const ensureShadowUI = (): boolean => {
    if (shadowHost) return true;
    if (!getClusterTabsList()) return false;
    ({ shadowHost, reRender } = createShadowUI(
      handleClusterChange,
      handleMarkerToggle,
    ));
    return true;
  };

  const reRenderUI = () => {
    if (!reRender || !CONFIG) return;
    reRender(CONFIG.default_id, CONFIG.show_markers);
  };

  /** Build the picker if the page has a place for it, then mount it. */
  const mountUI = () => {
    if (!ensureShadowUI() || !shadowHost) return;
    reRenderUI();
    injectUI(shadowHost);
  };

  async function start() {
    await ensureCampusData();
    // one storage read instead of three serial ones
    const c = await getConfigMany([
      "CLUSTERS_SHOW_MARKERS",
      "CLUSTERS_DEFAULT_ID",
      "CLUSTERS_OPEN_NEW_TAB",
      "CLUSTERS_CAMPUS",
    ] as const);
    // ensureCampusData() fills the cluster list only; the chair markers come
    // from SCREENS, which getClusterData() builds. Without this the markers
    // never drew on meta.intra and the toggle showed for every campus. The
    // file is already in the storage cache from the call above, so this
    // costs one read.
    if (c.CLUSTERS_CAMPUS) {
      try {
        await getClusterData(c.CLUSTERS_CAMPUS);
      } catch {}
    }
    CONFIG = {
      show_markers: c.CLUSTERS_SHOW_MARKERS,
      default_id: c.CLUSTERS_DEFAULT_ID,
    };

    mountUI();
    refreshMarkersSoon();

    if (c.CLUSTERS_OPEN_NEW_TAB) {
      document.addEventListener("click", onClusterProfileClick, true);
    }

    const findAndAttach = () => {
      // The cluster map is the SVG that contains seat <image> elements; the
      // first <svg> of the document is a navigation icon on Intra v3.
      const svg =
        document.querySelector("svg image")?.closest<SVGSVGElement>("svg") ??
        document.querySelector<SVGSVGElement>("svg"); // fallback: previous behaviour
      if (svg && svg !== observedSvgRoot) {
        if (svgObserver) svgObserver.disconnect();
        observedSvgRoot = svg;

        svgObserver = new MutationObserver(() => refreshMarkersSoon());
        svgObserver.observe(svg, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["x", "y", "transform"],
        });
        refreshMarkersSoon();
      }
    };

    findAndAttach();
    mountUI();

    const hashMatch = window.location.hash.match(/cluster-(\d+)/);
    const targetId = hashMatch ? hashMatch[1] : CONFIG.default_id;
    if (targetId) {
      // Observed instead of polled every 100 ms: the tab is clicked on the
      // microtask that follows its insertion, and a page that never has one
      // (most Intra pages) costs nothing.
      void waitForElement<HTMLAnchorElement>(`a[href="#cluster-${targetId}"]`, {
        timeoutMs: CLUSTER_TAB_WAIT_MS,
      }).then((el) => el?.click());
    }

    // Wait for the map SVG and our UI, but never for more than ~30 s: other
    // meta.intra pages have no cluster map at all. The old version re-ran the
    // whole search twice a second for those 30 s; now it only runs when the
    // page actually changed.
    const stopWatch = watchDom(
      () => {
        findAndAttach();
        mountUI();
        refreshMarkersSoon();
        return !!observedSvgRoot && !!document.getElementById("cluster-shadow-host");
      },
      { timeoutMs: MAP_WATCH_MS, debounceMs: 100, immediate: false },
    );
    addEventListener(
      "pagehide",
      () => {
        stopWatch();
        if (svgObserver) svgObserver.disconnect();
      },
      { once: true },
    );
  }

  function onClusterProfileClick(e: MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;

    const svgImage = target.closest("image[data-tooltip-login]");
    if (svgImage) {
      const login = svgImage.getAttribute("data-tooltip-login");
      if (login) {
        e.preventDefault();
        e.stopPropagation();
        window.open(
          `https://profile.intra.42.fr/users/${login}`,
          "_blank",
          "noopener",
        );
        return;
      }
    }

    // A modified click on a link already says where it goes (Ctrl/Cmd: a
    // background tab, Shift: a window): the browser does it. It used to
    // become a foreground window.open() like any other click.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = target.closest(
      "a[href*='profile.intra.42.fr/users/']",
    ) as HTMLAnchorElement | null;
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      window.open(link.href, "_blank", "noopener");
    }
  }

  // awaited so that failures are reported by the caller's try/catch in main.ts
  await start();
}
