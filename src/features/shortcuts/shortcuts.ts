import { getConfig } from "../../core/config.ts";
import { getStoredLinks, renderShortcutsDisplay } from "./shortcuts.ui.ts";
import { render, html } from "lit-html";
import { sharedStylesLink } from "../../core/styles/shared-styles.ts";

const CONTAINER_ID = "shortcuts-shadow-wrapper";
/** The Intra's "important links" banner exists on this host only. */
const BANNER_HOST = "profile-v3.intra.42.fr";
/** The settings that decide whether the pass has anything to do. */
const WORK_KEYS = [
  "SHORTCUTS_LINKS",
  "SHORTCUTS_HIDE_IMPORTANT_LINKS",
  "ACTIVE_SCRIPTS",
] as const;

async function shortcutsActive(): Promise<boolean> {
  const activeFeatures = await getConfig("ACTIVE_SCRIPTS");
  try {
    const active: unknown =
      typeof activeFeatures === "string"
        ? JSON.parse(activeFeatures)
        : activeFeatures;
    return Array.isArray(active) && active.includes("shortcuts");
  } catch {
    return false;
  }
}

/**
 * Whether the pass can change the banner: links to show, or the Intra's
 * block to hide. With neither (the default settings) there is nothing to
 * put back after a re-render, so nothing needs to watch the page.
 */
async function hasWork(): Promise<boolean> {
  if (!(await shortcutsActive())) return false;
  const [hideImportantLinks, links] = await Promise.all([
    getConfig("SHORTCUTS_HIDE_IMPORTANT_LINKS"),
    getStoredLinks(),
  ]);
  return !!hideImportantLinks || links.some((l) => l.url && l.name);
}

export async function injectShortcutsDisplay() {
  if (document.getElementById(CONTAINER_ID)) return;

  if (!(await shortcutsActive())) {
    document.getElementById(CONTAINER_ID)?.remove();
    return;
  }

  const banner = document.querySelector(
    ".w-full.flex.flex-row.gap-8.py-4.px-8.items-center",
  );
  if (!banner) return;

  const [hideImportantLinks, alignment, links, openNewTab] = await Promise.all([
    getConfig("SHORTCUTS_HIDE_IMPORTANT_LINKS"),
    getConfig("SHORTCUTS_ALIGNMENT"),
    getStoredLinks(),
    getConfig("ADVANCED_OPEN_LINKS_NEW_TAB"),
  ]);

  const displayLinks = links.filter((l) => l.url && l.name);

  const infoBlock = banner.querySelector(
    ".flex.flex-col.text-sm.w-full.gap-1",
  ) as HTMLElement;

  if (hideImportantLinks) {
    const icon = banner.querySelector(
      "svg.hidden.lg\\:block",
    ) as HTMLElement | null;
    if (icon) icon.style.display = "none";
    if (infoBlock) infoBlock.style.display = "none";
  }

  // No link: the Intra's block keeps its full width, untouched. It used to be
  // narrowed to 50% and widened back on every pass, twice per DOM change.
  if (displayLinks.length === 0) return;

  if (!hideImportantLinks && infoBlock) {
    infoBlock.style.width = "50%";
    infoBlock.classList.remove("w-full");
  }

  const wrapper = document.createElement("div");
  wrapper.id = CONTAINER_ID;
  const justifyMap: Record<string, string> = {
    left: "flex-start",
    center: "center",
    right: "flex-end",
  };
  wrapper.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: ${hideImportantLinks ? justifyMap[alignment] || "flex-start" : "flex-start"};
    gap: 16px;
    width: ${hideImportantLinks ? "100%" : "50%"};
    margin-right: 20px;
    padding: 8px 0;
    box-sizing: border-box;
  `;

  const shadowRoot = wrapper.attachShadow({ mode: "open" });
  banner.appendChild(wrapper);

  if (shadowRoot) {
    render(
      html`
        ${sharedStylesLink()}
        <style>
          .separator {
            width: 3px;
            height: 100px;
            background-color: var(--base-300, #cbd5e1);
            margin: 0 8px;
            flex-shrink: 0;
          }
        </style>
        ${hideImportantLinks ? "" : html`<div class="separator"></div>`}
        ${renderShortcutsDisplay(links, undefined, openNewTab)}
      `,
      shadowRoot,
    );
  }
}

let observer: MutationObserver | null = null;

/**
 * Puts the links back (and hides the Intra's block again) after profile-v3
 * re-renders the banner. It lives until pagehide, with no deadline: the
 * single-page app re-renders the banner on every in-app move.
 */
export function setupShortcutsObserver() {
  if (observer) return;
  if (!document.body) {
    setTimeout(setupShortcutsObserver, 100);
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const mine = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!document.getElementById(CONTAINER_ID)) {
        injectShortcutsDisplay();
      }
    }, 300);
  });
  observer = mine;

  mine.observe(document.body, { childList: true, subtree: true });

  window.addEventListener(
    "pagehide",
    () => {
      mine.disconnect();
      clearTimeout(timer);
      if (observer === mine) observer = null;
    },
    { once: true },
  );
}

/**
 * Nothing to do yet: wait for a setting that gives the pass work (a link
 * added in the hub, the block hidden) instead of watching the page for it.
 * The observer used to run on every DOM change for the tab's life with the
 * default settings, re-reading them and re-querying the document each time.
 */
function startWhenNeeded(): void {
  const onChanged = chrome.storage?.onChanged;
  if (!onChanged) return;
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local" || !WORK_KEYS.some((k) => k in changes)) return;
    void hasWork().then((work) => {
      if (!work || observer) return;
      onChanged.removeListener(listener);
      setupShortcutsObserver();
      void injectShortcutsDisplay();
    });
  };
  onChanged.addListener(listener);
  window.addEventListener("pagehide", () => onChanged.removeListener(listener), {
    once: true,
  });
}

export async function initShortcuts() {
  // Gated on the host, never the path: moving to another Intra host reloads
  // the page, but profile-v3 is a single-page app, and a student who lands on
  // another of its pages can reach the banner without a reload.
  if (location.hostname !== BANNER_HOST) return;
  if (await hasWork()) setupShortcutsObserver();
  else startWhenNeeded();
  await injectShortcutsDisplay();
}
