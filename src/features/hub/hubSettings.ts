import { html, render } from "lit-html";
import { FeatureId } from "./hubSettings.data.ts";
import { getConfig } from "../../config.ts";
import GEAR_SVG from "../../assets/svg/settings_gear.svg?raw";
import USERS_SVG from "../../assets/svg/users.svg?raw";
import GLOBE_OUTLINE_SVG from "../../assets/svg/globe-outline.svg?raw";
import { getIsLight } from "../profile/theme/theme-manager.ts";
import { getActiveFeatures } from "./hubSettings.storage.ts";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { openStudentsDialog } from "../profile/students/index.ts";
import { openClusterDialog } from "../clusters/map-dialog.ts";
import { isPisciner } from "../../utils/intrapy.ts";
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

function renderStudentsButton(
  onClick: (e: Event) => void,
): ReturnType<typeof html> {
  return html`<a
    id="ft-students-btn"
    class="py-5 w-full flex justify-center hover:opacity-100 opacity-40"
    href="#"
    data-tip="Students"
    data-tip-pos="right"
    @click="${(e: Event) => {
      e.preventDefault();
      onClick(e);
    }}"
  >
    ${unsafeHTML(
      USERS_SVG.replace("<svg", '<svg width="25" height="25" stroke="#fff"'),
    )}
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
 * whether the campus-12 buttons belong in the sidebar. The value only changes
 * when the campus is detected, which the listener below picks up.
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
  // Campus still unknown: keep watching, the buttons may still be due.
  if (campusIsTwelve === undefined) return false;
  if (!campusIsTwelve) return true;
  return (
    !!document.getElementById("ft-students-btn") &&
    !!document.getElementById("ft-clusters-btn")
  );
}

export function mountGearButton(): void {
  const open = async () => {
    void gearClicked();
    const { openHubModal } = await import("./hubSettings.ui.ts");

    const active = await getActiveFeatures();

    await openHubModal(active);
  };

  const sidebar = findSidebarMainGroup();

  const openStudents = async () => {
    try {
      const login = await getConfig("CLOUD_LOGIN");
      if (login && (await isPisciner(login))) {
        alert("You need to be a student to access that.");
        return;
      }
      openStudentsDialog();
    } catch (err) {}
  };

  const openClusters = () => {
    try {
      openClusterDialog();
    } catch (err) {}
  };

  void (async () => {
    if ((await readCampus()) !== "12") return;
    if (!sidebar) return;

    if (!document.getElementById("ft-students-btn")) {
      const container = document.createElement("div");
      render(renderStudentsButton(openStudents), container);
      const anchor = sidebar.children[1] ?? sidebar.firstElementChild;
      if (anchor) {
        anchor.after(container.firstElementChild!);
      } else {
        sidebar.appendChild(container.firstElementChild!);
      }
    }

    const studentsBtn = document.getElementById("ft-students-btn");
    if (studentsBtn && !document.getElementById("ft-clusters-btn")) {
      const isLight = await getIsLight();
      const color = isLight ? "#1a1d24" : "#fff";
      const container = document.createElement("div");
      render(renderClustersButton(openClusters, color), container);
      studentsBtn.after(container.firstElementChild!);
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
