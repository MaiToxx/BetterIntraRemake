/**
 * The settings hub: a <dialog> around a shadow root that holds the header,
 * the tabs (controls/tab-panel.ts) and the footer (light/dark switch, cloud
 * status, auto push, Reload). hubSettings.ts imports this module on demand
 * when the gear is clicked; openHubModal is its only export.
 */
import { html, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import RELOAD_SVG from "../../assets/svg/reload.svg?raw";
import SUN_SVG from "../../assets/svg/sun.svg?raw";
import MOON_SVG from "../../assets/svg/moon.svg?raw";
import CLOUD_SVG from "../../assets/svg/cloud.svg?raw";
import ICON_SVG from "../../assets/svg/icon.svg?raw";
import { getConfig } from "../../core/config.ts";
import { bindTooltips } from "../../core/dom/tooltip.ts";
import { sharedStylesLink } from "../../core/styles/shared-styles.ts";
import {
  THEMES,
  getEffectiveTheme,
  getIsLight,
} from "../../core/theme/theme-manager.ts";
import {
  clearAuthFailed,
  loginWith42,
  syncToCloud,
} from "../account/account.ts";
import {
  HUB_INFO,
  HUB_SETTING_DEFS,
  INTRA_FONT,
  type FeatureId,
} from "./hubSettings.data.ts";
import { bindDependents, initialGates } from "./dependents.ts";
import { loadLiveOptions } from "./controls/context.ts";
import { bindTabPanels, renderTabsContent } from "./controls/tab-panel.ts";

export async function openHubModal(active: FeatureId[]) {
  let dialog = document.getElementById("hub-dialog") as HTMLDialogElement;
  if (!dialog) {
    createModal(active);
    dialog = document.getElementById("hub-dialog") as HTMLDialogElement;
  }

  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";

  dialog.showModal();

  dialog.addEventListener(
    "close",
    () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    },
    { once: true },
  );
}

function renderDialogShell(): ReturnType<typeof html> {
  return html`
    <div
      class="w-full h-full p-0 overflow-hidden bg-base-100 rounded-3xl shadow-2xl flex flex-col relative"
    >
      <div id="hub-shadow-wrapper" class="w-full h-full"></div>
    </div>
  `;
}

/** The <dialog> itself: closes on a click outside it, sized to the window. */
function createDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.id = "hub-dialog";
  dialog.className =
    "modal-box hub-modal-box p-0 overflow-hidden bg-base-100 rounded-3xl shadow-2xl border-none outline-none";

  const tempContainer = document.createElement("div");
  render(renderDialogShell(), tempContainer);
  dialog.appendChild(tempContainer.firstElementChild!);

  document.body.appendChild(dialog);
  dialog.addEventListener("click", (e) => {
    const dialogDimensions = dialog.getBoundingClientRect();
    if (
      e.clientX < dialogDimensions.left ||
      e.clientX > dialogDimensions.right ||
      e.clientY < dialogDimensions.top ||
      e.clientY > dialogDimensions.bottom
    ) {
      dialog.close();
    }
  });

  const applyDesktopLock = () => {
    dialog.style.width = "100%";
    dialog.style.height = "100%";

    if (window.matchMedia("(min-width: 1024px)").matches) {
      dialog.style.maxWidth = "1200px";
      dialog.style.maxHeight = "800px";
    } else {
      dialog.style.maxWidth = "calc(100dvw - 1rem)";
      dialog.style.maxHeight = "calc(100dvh - 1rem)";
    }
  };

  applyDesktopLock();
  window.addEventListener("resize", applyDesktopLock);
  dialog.addEventListener(
    "close",
    () => window.removeEventListener("resize", applyDesktopLock),
    { once: true },
  );
  return dialog;
}

async function getInitialTheme() {
  return getEffectiveTheme();
}

/**
 * Builds the modal once per page: reads what it shows at open (theme, gates,
 * live lists, cloud state), renders it, then wires the footer, the tab
 * headers and the dependencies.
 */
async function createModal(active: FeatureId[]): Promise<void> {
  const dialog =
    (document.getElementById("hub-dialog") as HTMLDialogElement | null) ??
    createDialog();

  const wrapper = dialog.querySelector("#hub-shadow-wrapper")!;
  const shadow = wrapper.shadowRoot || wrapper.attachShadow({ mode: "open" });

  const currentTheme = await getInitialTheme();
  const gates = await initialGates();
  const live = await loadLiveOptions();
  const tabsContent = renderTabsContent(active, gates, live);
  const lastSync = (await chrome.storage.local.get("LAST_CLOUD_SYNC"))
    .LAST_CLOUD_SYNC;
  const isConnected = !!(await getConfig("CLOUD_TOKEN"));
  const authFailed = !!(await getConfig("CLOUD_AUTH_FAILED"));
  const dateString =
    typeof lastSync === "number" || typeof lastSync === "string"
      ? new Date(lastSync).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "--:--";

  const modalTemplate = html`${sharedStylesLink()}<style>
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }
      font-family: ${INTRA_FONT};
      input,
      button,
      select,
      textarea,
      .tab,
      h2,
      h3 {
        font-family: ${INTRA_FONT} !important;
      }
      .tab-content {
        height: 100%;
        overflow-y: auto;
      }
    </style>
    <div
      class="flex flex-col h-full text-base-content bg-base-100"
      data-theme="${currentTheme}"
    >
      <div
        class="flex-none flex items-center justify-between px-6 py-4 border-b border-base-200 bg-base-100 z-10"
      >
        <div class="flex items-center gap-3">
          <div
            class="size-8 flex items-center justify-center"
            style="color: #00babc;"
          >
            ${unsafeHTML(ICON_SVG)}
          </div>
          <div class="flex items-baseline gap-2">
            <h3 class="font-bold text-xl tracking-tight">${HUB_INFO.name}</h3>
            <p class="text-[14px] opacity-60 font-bold tracking-widest">
              v${HUB_INFO.version}
            </p>
          </div>
        </div>
        <button
          class="btn btn-circle btn-ghost"
          @click="${() => dialog.close()}"
        >
          ✕
        </button>
      </div>

      ${authFailed
        ? html`<div
            class="flex-none alert alert-warning mx-4 mt-3 rounded-xl flex items-center justify-between"
          >
            <span class="text-sm font-semibold"
              >42 token expired - friends, marks, and cloud features
              stopped</span
            >
            <button
              class="btn btn-warning btn-sm font-bold"
              @click="${() => {
                dialog.close();
                loginWith42(async () => {
                  await clearAuthFailed();
                  window.location.reload();
                });
              }}"
            >
              Reconnect
            </button>
          </div>`
        : ""}

      <div
        role="tablist"
        class="tabs tabs-lg tabs-border flex-1 overflow-hidden"
      >
        ${tabsContent}
      </div>

      <div
        class="flex-none p-4 border-t border-base-200 bg-base-200/50 flex justify-between items-center"
      >
        <div class="flex items-center gap-3">
          <label
            class="swap btn btn-accent border border-base-content/20 text-center items-center"
          >
            <input
              type="checkbox"
              id="hub-theme-toggle"
              ?checked="${currentTheme === "dark"}"
            />
            <span class="swap-on flex items-center justify-center gap-1">
              ${unsafeHTML(SUN_SVG)}
              <span class="text-sm font-bold">Light</span>
            </span>
            <span class="swap-off flex items-center justify-center gap-1">
              ${unsafeHTML(MOON_SVG)}
              <span class="text-sm font-bold">Dark</span>
            </span>
          </label>
          <div class="flex items-center gap-2 text-xs">
            ${isConnected
              ? html`<span class="btn btn-success border border-base-content/20"
                  ><span class="size-4 inline-flex items-center"
                    >${unsafeHTML(CLOUD_SVG)}</span
                  >
                  Connected</span
                >`
              : html`<span class="btn btn-error border border-base-content/20"
                  >Offline</span
                >`}
            <span class="btn btn-info border border-base-content/20"
              >Synced at ${dateString}</span
            >
            ${isConnected
              ? html`<div class="join">
                  <input
                    type="radio"
                    name="hub-auto-push"
                    class="join-item btn btn-outline border-base-content/20"
                    aria-label="Manual push"
                    value="manual"
                    @change="${() =>
                      chrome.storage.local.set({
                        CLOUD_SYNC_ENABLED: false,
                      })}"
                  />
                  <input
                    type="radio"
                    name="hub-auto-push"
                    class="join-item btn btn-outline border-base-content/20"
                    aria-label="Auto push"
                    value="auto"
                    @change="${() =>
                      chrome.storage.local.set({
                        CLOUD_SYNC_ENABLED: true,
                      })}"
                  />
                </div>`
              : ""}
          </div>
        </div>
        <button
          id="hub-reload"
          class="btn btn-success px-8 font-bold flex items-center gap-2"
        >
          <span class="size-5 flex items-center justify-center">
            ${unsafeHTML(RELOAD_SVG)}
          </span>
          Reload
        </button>
      </div>
    </div>`;

  render(modalTemplate, shadow);

  bindTooltips(shadow, getIsLight);

  await bindThemeToggle(shadow);
  await bindReload(shadow);
  bindTabPanels(shadow);
  bindDependents(shadow);
}

/**
 * Light/dark switch of the footer. It starts on the side of the saved theme
 * preset, and flips the hub to the matching theme of the other side.
 */
async function bindThemeToggle(shadow: ShadowRoot): Promise<void> {
  const themeToggle = shadow.querySelector(
    "#hub-theme-toggle",
  ) as HTMLInputElement;
  const hubContainer = shadow.querySelector("[data-theme]");
  const ghIcon = shadow.querySelector('img[alt="GitHub"]') as HTMLElement;

  const presetKey = (await getConfig("PROFILE_THEME_PRESET")) || "dark";
  const validPreset = HUB_SETTING_DEFS.profile
    .find((s) => s.key === "PROFILE_THEME_PRESET")
    ?.options?.some((o) => o.value === presetKey)
    ? presetKey
    : "dark";
  hubContainer?.setAttribute("data-theme", validPreset);
  const isLightPreset =
    validPreset === "light" ||
    (validPreset !== "dark" && !!THEMES[validPreset]?.light);
  if (themeToggle) themeToggle.checked = !isLightPreset;

  themeToggle?.addEventListener("change", async () => {
    const isDark = themeToggle.checked;
    const preset = (await getConfig("PROFILE_THEME_PRESET")) || "dark";
    const isLightPreset =
      preset === "light" || (preset !== "dark" && !!THEMES[preset]?.light);
    const theme = isDark
      ? isLightPreset
        ? "dark"
        : preset
      : isLightPreset
        ? preset
        : "light";

    hubContainer?.setAttribute("data-theme", theme);
    await chrome.storage.local.set({
      BETTER_INTRA_THEME: isDark ? "dark" : "light",
    });

    if (ghIcon) {
      ghIcon.style.filter = isDark ? "none" : "invert(1) brightness(0)";
    }
  });
}

/** Reload button, after a cloud push when the auto-push radio says so. */
async function bindReload(shadow: ShadowRoot): Promise<void> {
  const reloadBtn = shadow.querySelector("#hub-reload");
  const autoPushRadios = shadow.querySelectorAll(
    'input[name="hub-auto-push"]',
  ) as NodeListOf<HTMLInputElement>;
  const isAutoPush = (await getConfig("CLOUD_SYNC_ENABLED")) === true;
  autoPushRadios.forEach(
    (r) => (r.checked = r.value === (isAutoPush ? "auto" : "manual")),
  );

  reloadBtn?.addEventListener("click", async () => {
    const checked = shadow.querySelector(
      'input[name="hub-auto-push"]:checked',
    ) as HTMLInputElement | null;
    if (checked?.value === "auto") {
      try {
        await syncToCloud();
      } catch {}
    }
    location.reload();
  });
}
