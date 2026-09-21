import { html, render } from "lit-html";
import { FeatureId } from "./hubSettings.data.ts";
import { getConfig } from "../../config.ts";
import GEAR_SVG from "../../assets/svg/settings_gear.svg?raw";
import GLOBE_OUTLINE_SVG from "../../assets/svg/globe-outline.svg?raw";
import { getIsLight } from "../profile/theme/theme-manager.ts";
import { getActiveFeatures } from "./hubSettings.storage.ts";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { openClusterDialog } from "../clusters/map-dialog.ts";
import { gearClicked } from "../eggs/eggs.ts";
import { watchDom } from "../../utils/dom-wait.ts";

function findSidebarMainGroup(): HTMLDivElement | null {
  const profileLink = document.querySelector<HTMLAnchorElement>(
    'a[href="https://profile-v3.intra.42.fr"]',
  );
  return (
    profileLink?.closest<HTMLDivElement>("div.flex.flex-col.w-full") ||
    document.querySelector<HTMLDivElement>(
      "div.flex.flex-col.w-full:not(.pb-16)",
    )
  );
}

function renderGearButton(
  onClick: (e: Event) => void,
): ReturnType<typeof html> {
  return html`<a
    id="hub-gear-btn"
    class="py-5 w-full flex justify-center hover:opacity-100 opacity-40"
    href="#"
    @click="${(e: Event) => {
      e.preventDefault();
      onClick(e);
    }}"
  >
    ${unsafeHTML(GEAR_SVG)}
  </a>`;
}

function renderClustersButton(
  onClick: (e: Event) => void,
  color: string,
): ReturnType<typeof html> {
  return html`<a
    id="ft-clusters-btn"
    class="py-5 w-full flex justify-center hover:opacity-100 opacity-40"
    href="#"
    data-tip="Clusters"
    data-tip-pos="right"
    @click="${(e: Event) => {
      e.preventDefault();
      onClick(e);
    }}"
  >
    ${unsafeHTML(
      GLOBE_OUTLINE_SVG.replace(
        "<svg",
        `<svg width="25" height="25" stroke="${color}"`,
      ),
    )}
  </a>`;
}

/**
 * CLUSTERS_CAMPUS, read once per page instead of once per mount attempt.
 *
 * WHY: mountGearButton() used to run every 500 ms for 10 s, and every run
 * awaited this key - 21 storage round-trips on every Intra page just to decide
 * whether the campus-12 Clusters button belongs in the sidebar. The value only
 * changes when the campus is detected, which the listener below picks up.
 */
let campusPromise: Promise<string> | null = null;
let campusIsTwelve: boolean | undefined;
let campusListenerInstalled = false;

const readCampus = (): Promise<string> => {
  if (!campusPromise) {
    campusPromise = getConfig("CLUSTERS_CAMPUS")
      .then((campus) => {
        campusIsTwelve = campus === "12";
        return campus;
      })
      .catch(() => {
        campusIsTwelve = false;
        return "";
      });
  }
  return campusPromise;
};

/**
 * The campus is only known once the page fetches it (42_CAMPUS_DETECTED), so
 * it can turn into "12" after the sidebar was already skipped. The poll used
 * to catch that; a storage listener catches it without waking up 20 times.
 */
function installCampusListener(): void {
  if (campusListenerInstalled) return;
  if (!chrome.storage.onChanged?.addListener) return;
  campusListenerInstalled = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("CLUSTERS_CAMPUS" in changes)) return;
    const campus = String(changes.CLUSTERS_CAMPUS.newValue ?? "");
    campusIsTwelve = campus === "12";
    campusPromise = Promise.resolve(campus);
    mountGearButton();
  });
}

/** Everything this feature has to put in the sidebar is in place. */
function isSidebarComplete(): boolean {
  if (!document.getElementById("hub-gear-btn")) return false;
  // Campus still unknown: keep watching, the Clusters button may still be due.
  if (campusIsTwelve === undefined) return false;
  if (!campusIsTwelve) return true;
  return !!document.getElementById("ft-clusters-btn");
}

export function mountGearButton(): void {
  const open = async () => {
    void gearClicked();
    const { openHubModal } = await import("./hubSettings.ui.ts");

    const active = await getActiveFeatures();

    await openHubModal(active);
  };

  const sidebar = findSidebarMainGroup();

  const openClusters = () => {
    try {
      openClusterDialog();
    } catch (err) {}
  };

  void (async () => {
    if ((await readCampus()) !== "12") return;
    if (!sidebar) return;

    // Where the Students button (removed: its worker endpoints need a 42 API
    // application) used to sit, so Clusters keeps its place in the sidebar.
    // The anchor is taken before the await, like the Students slot was, so the
    // gear button appended meanwhile cannot shift it.
    if (!document.getElementById("ft-clusters-btn")) {
      const anchor = sidebar.children[1] ?? sidebar.firstElementChild;
      const isLight = await getIsLight();
      const color = isLight ? "#1a1d24" : "#fff";
      const container = document.createElement("div");
      render(renderClustersButton(openClusters, color), container);
      if (anchor) {
        anchor.after(container.firstElementChild!);
      } else {
        sidebar.prepend(container.firstElementChild!);
      }
    }
  })();

  if (document.getElementById("hub-gear-btn")) return;

  if (sidebar) {
    const container = document.createElement("div");
    render(renderGearButton(open), container);
    sidebar.appendChild(container.firstElementChild!);
  }
}

/** Same budget as the old 500 ms x 20 poll. */
const SIDEBAR_WATCH_MS = 10000;

export async function initHubSettings(): Promise<FeatureId[]> {
  const active = await getActiveFeatures();
  installCampusListener();
  // The sidebar is rendered by React, so we mount when it actually appears
  // instead of re-trying twice a second for ten seconds. watchDom stops as
  // soon as everything is in place, on pagehide, and at the deadline.
  watchDom(
    () => {
      mountGearButton();
      return isSidebarComplete();
    },
    { timeoutMs: SIDEBAR_WATCH_MS, debounceMs: 50 },
  );
  return active;
}
