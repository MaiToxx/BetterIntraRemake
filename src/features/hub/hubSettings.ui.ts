/**
 * The settings hub: a <dialog> around a shadow root that holds the header
 * (title, settings search), the tabs (controls/tab-panel.ts) and the footer
 * (light/dark switch, cloud account, push mode, Reload). hubSettings.ts
 * imports this module on demand when the gear is clicked; openHubModal is its
 * main export.
 */
import { html, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import RELOAD_SVG from "../../assets/svg/reload.svg?raw";
import SUN_SVG from "../../assets/svg/sun.svg?raw";
import MOON_SVG from "../../assets/svg/moon.svg?raw";
import CLOUD_SVG from "../../assets/svg/cloud.svg?raw";
import ICON_SVG from "../../assets/svg/icon.svg?raw";
import { CLOUD_SYNC_KEYS, CONFIG_DEFAULT, getConfig } from "../../core/config.ts";
import { LOCAL_ONLY_KEYS } from "../../core/config/keys.ts";
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
  logoutCloud,
  syncToCloud,
} from "../account/account.ts";
import {
  FEATURE_DEFS,
  HUB_INFO,
  HUB_SETTING_DEFS,
  INTRA_FONT,
  isLiveKey,
  normalizeSearchText,
  type FeatureId,
} from "./hubSettings.data.ts";
import { bindDependents, initialGates } from "./dependents.ts";
import { loadLiveOptions } from "./controls/context.ts";
import {
  bindTabPanels,
  rememberedTab,
  renderTabsContent,
} from "./controls/tab-panel.ts";

/** How long the hub waits after the last change before an automatic push. */
export const AUTO_PUSH_DELAY_MS = 1000;

export async function openHubModal(active: FeatureId[]) {
  let dialog = document.getElementById("hub-dialog") as HTMLDialogElement;
  if (!dialog) {
    // not awaited: the empty dialog opens at once and fills as the lists load
    void createModal(active);
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
  // Its visible title is inside the shadow root, where aria-labelledby on
  // this light-DOM element cannot reach: name it directly.
  dialog.setAttribute("aria-label", `${HUB_INFO.name} settings`);
  dialog.className =
    "modal-box hub-modal-box p-0 overflow-hidden bg-base-100 rounded-3xl shadow-2xl border-none outline-none";

  const tempContainer = document.createElement("div");
  render(renderDialogShell(), tempContainer);
  dialog.appendChild(tempContainer.firstElementChild!);

  document.body.appendChild(dialog);
  dialog.addEventListener("click", (e) => {
    // Only a click on the backdrop, which targets the <dialog> itself. A key
    // that activates a control inside (Space on a switch, Enter on a button,
    // an arrow key moving between the tabs) fires a click at (0, 0), outside
    // the box: the bounds test alone closed the hub on every such key.
    if (e.target !== dialog) return;
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
 * "Never synced", or "Synced 12 Sep 14:03": a time alone read like today
 * whatever the day of the last push.
 */
export function formatSyncStatus(lastSync: unknown, now = new Date()): string {
  if (typeof lastSync !== "number" && typeof lastSync !== "string") {
    return "Never synced";
  }
  const date = new Date(lastSync);
  if (Number.isNaN(date.getTime())) return "Never synced";
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `Synced at ${time}`;
  const day = date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `Synced ${day} ${time}`;
}

/**
 * Builds the modal once per page: reads what it shows at open (theme, gates,
 * live lists, cloud state), renders it, then wires the search, the footer,
 * the tab headers and the dependencies.
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
  const tabsContent = renderTabsContent(active, gates, live, rememberedTab());
  const lastSync = (await chrome.storage.local.get("LAST_CLOUD_SYNC"))
    .LAST_CLOUD_SYNC;
  const isConnected = !!(await getConfig("CLOUD_TOKEN"));
  const authFailed = !!(await getConfig("CLOUD_AUTH_FAILED"));
  const login = (await getConfig("CLOUD_LOGIN")) || "";

  // The banner's Reconnect and the footer's Connect must not start two logins
  // at once: the footer button steps aside while the banner is up.
  const connect = () => {
    dialog.close();
    loginWith42(async () => {
      await clearAuthFailed();
      window.location.reload();
    });
  };
  const signOut = async () => {
    if (!window.confirm("Sign out of Better Intra on this browser?")) return;
    await logoutCloud();
    window.location.reload();
  };

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
      /* the search filter, apart from the "hidden" the dependencies own */
      .search-hidden {
        display: none !important;
      }
    </style>
    <div
      class="flex flex-col h-full text-base-content bg-base-100"
      data-theme="${currentTheme}"
    >
      <div
        class="flex-none flex items-center justify-between gap-4 px-6 py-4 border-b border-base-200 bg-base-100 z-10"
      >
        <div class="flex items-center gap-3">
          <div
            class="size-8 flex items-center justify-center"
            style="color: #00babc;"
            aria-hidden="true"
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
        <div class="flex-1 flex flex-col items-stretch max-w-md min-w-0">
          <input
            type="search"
            id="hub-search"
            class="input input-sm w-full"
            placeholder="Search settings"
            aria-label="Search settings"
            aria-describedby="hub-search-results"
            autocomplete="off"
          />
          <span
            id="hub-search-results"
            class="text-xs opacity-70 mt-1 min-h-4"
            role="status"
          ></span>
        </div>
        <button
          type="button"
          class="btn btn-circle btn-ghost"
          aria-label="Close settings"
          @click="${() => dialog.close()}"
        >
          <span aria-hidden="true">✕</span>
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
            <button class="btn btn-warning btn-sm font-bold" @click="${connect}">
              Reconnect
            </button>
          </div>`
        : ""}

      <div
        role="tablist"
        aria-label="Settings sections"
        class="tabs tabs-lg tabs-border flex-1 overflow-hidden"
      >
        ${tabsContent}
      </div>

      <div
        id="hub-footer"
        class="flex-none p-4 border-t border-base-200 bg-base-200/50 flex justify-between items-center gap-4"
      >
        <div class="flex items-center gap-3 flex-wrap">
          <label
            class="swap btn btn-accent border border-base-content/20 text-center items-center"
          >
            <!-- Both faces of the swap are in the DOM (one is only faded out),
              so the label's text reads "Light Dark": the switch is named by
              what "checked" means instead. -->
            <input
              type="checkbox"
              id="hub-theme-toggle"
              aria-label="Dark theme"
              ?checked="${currentTheme === "dark"}"
            />
            <span
              class="swap-on flex items-center justify-center gap-1"
              aria-hidden="true"
            >
              ${unsafeHTML(SUN_SVG)}
              <span class="text-sm font-bold">Light</span>
            </span>
            <span
              class="swap-off flex items-center justify-center gap-1"
              aria-hidden="true"
            >
              ${unsafeHTML(MOON_SVG)}
              <span class="text-sm font-bold">Dark</span>
            </span>
          </label>
          <div class="flex items-center gap-2 text-xs flex-wrap">
            ${isConnected
              ? html`<span
                    class="badge badge-success badge-lg gap-1 border border-base-content/20"
                    ><span class="size-4 inline-flex items-center" aria-hidden="true"
                      >${unsafeHTML(CLOUD_SVG)}</span
                    >
                    ${login ? `Connected as ${login}` : "Connected"}</span
                  >
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    @click="${signOut}"
                  >
                    Sign out
                  </button>`
              : authFailed
                ? ""
                : html`<button
                    type="button"
                    class="btn btn-error btn-sm border border-base-content/20 font-bold"
                    @click="${connect}"
                  >
                    Connect with 42
                  </button>`}
            <span
              id="hub-sync-status"
              class="badge badge-info badge-lg border border-base-content/20"
              >${formatSyncStatus(lastSync)}</span
            >
            ${isConnected
              ? html`<div
                  class="join"
                  role="radiogroup"
                  aria-label="Cloud push"
                >
                  <input
                    type="radio"
                    name="hub-auto-push"
                    class="join-item btn btn-sm btn-outline border-base-content/20"
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
                    class="join-item btn btn-sm btn-outline border-base-content/20"
                    aria-label="Auto push"
                    value="auto"
                    @change="${() =>
                      chrome.storage.local.set({
                        CLOUD_SYNC_ENABLED: true,
                      })}"
                  />
                </div>`
              : ""}
            <span id="hub-push-status" class="hidden" role="status"></span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span
            id="hub-reload-hint"
            class="text-sm font-semibold text-warning hidden"
            role="status"
            aria-live="polite"
          ></span>
          <button
            id="hub-reload"
            class="btn btn-success px-8 font-bold flex items-center gap-2"
          >
            <span class="size-5 flex items-center justify-center" aria-hidden="true">
              ${unsafeHTML(RELOAD_SVG)}
            </span>
            Reload
          </button>
        </div>
      </div>
    </div>`;

  render(modalTemplate, shadow);

  bindTooltips(shadow, getIsLight);

  await bindThemeToggle(shadow);
  await bindCloudSync(shadow, dialog);
  bindTabPanels(shadow);
  bindDependents(shadow);
  bindSearch(shadow);
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

/** A key a user changes in the hub, as opposed to the session and the caches. */
function isUserSetting(key: string): boolean {
  return key in CONFIG_DEFAULT && !LOCAL_ONLY_KEYS.includes(key as never);
}

/**
 * The footer's cloud and reload logic, fed by storage.onChanged while the
 * dialog is open: every control writes to storage in the end, whichever
 * module draws it, so this is the one place that sees every change.
 *
 * - A change to a setting the page does not apply live lights up "Reload to
 *   apply" next to the Reload button (the card carries a "reload" tag).
 * - With Auto push, a change to a synced setting schedules one push shortly
 *   after the last change; the outcome is written in the footer, and a
 *   failure keeps the settings local instead of vanishing into a reload.
 * - Reload pushes first when Auto is on and something is not pushed yet, and
 *   stays on the hub when that push fails.
 */
async function bindCloudSync(
  shadow: ShadowRoot,
  dialog: HTMLDialogElement,
): Promise<void> {
  const reloadBtn = shadow.querySelector<HTMLButtonElement>("#hub-reload");
  const reloadHint = shadow.querySelector<HTMLElement>("#hub-reload-hint");
  const pushStatus = shadow.querySelector<HTMLElement>("#hub-push-status");
  const syncStatus = shadow.querySelector<HTMLElement>("#hub-sync-status");
  const autoPushRadios = shadow.querySelectorAll(
    'input[name="hub-auto-push"]',
  ) as NodeListOf<HTMLInputElement>;
  const isAutoPush = (await getConfig("CLOUD_SYNC_ENABLED")) === true;
  autoPushRadios.forEach(
    (r) => (r.checked = r.value === (isAutoPush ? "auto" : "manual")),
  );
  const autoSelected = () =>
    (
      shadow.querySelector(
        'input[name="hub-auto-push"]:checked',
      ) as HTMLInputElement | null
    )?.value === "auto";

  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const showPushStatus = (text: string, ok: boolean) => {
    if (!pushStatus) return;
    pushStatus.textContent = text;
    pushStatus.className = ok
      ? "text-xs font-semibold text-success"
      : "text-xs font-semibold text-error";
  };

  const push = async (): Promise<boolean> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    let ok = false;
    try {
      ok = await syncToCloud();
    } catch {
      ok = false;
    }
    if (ok) {
      dirty = false;
      showPushStatus("Pushed to the cloud", true);
      if (syncStatus) {
        const last = (await chrome.storage.local.get("LAST_CLOUD_SYNC"))
          .LAST_CLOUD_SYNC;
        syncStatus.textContent = formatSyncStatus(last);
      }
    } else {
      showPushStatus(
        "Push failed - settings kept locally, check the cloud connection",
        false,
      );
    }
    return ok;
  };

  const schedulePush = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void push();
    }, AUTO_PUSH_DELAY_MS);
  };

  const markReloadNeeded = () => {
    if (!reloadHint || !reloadBtn) return;
    reloadHint.textContent = "Reload to apply";
    reloadHint.classList.remove("hidden");
    reloadBtn.classList.remove("btn-success");
    reloadBtn.classList.add("btn-warning");
  };

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !dialog.open) return;
    for (const key of Object.keys(changes)) {
      if (!isUserSetting(key)) continue;
      if (!isLiveKey(key)) markReloadNeeded();
      if (CLOUD_SYNC_KEYS.includes(key as never)) {
        dirty = true;
        if (autoSelected()) schedulePush();
      }
    }
  });

  // A push still waiting when the hub closes goes out now: the user is done
  // editing, and "Auto" must not depend on how the hub was closed.
  dialog.addEventListener("close", () => {
    if (timer && autoSelected()) void push();
  });

  reloadBtn?.addEventListener("click", async () => {
    if (autoSelected() && (dirty || timer)) {
      reloadBtn.disabled = true;
      const ok = await push();
      reloadBtn.disabled = false;
      if (!ok) return;
    }
    location.reload();
  });
}

/**
 * The settings search of the header. It filters the cards of every tab by
 * label and description (case and accents ignored), counts the matches on
 * each tab, names the tabs that match under the field, and moves to the first
 * matching tab when the current one has none. Escape clears it; "/" focuses
 * it from anywhere in the hub that is not a text field.
 *
 * The filter has its own class: the "hidden" class belongs to the dependency
 * gating (dependents.ts) and the feature switch, and both must survive a
 * search and its clearing.
 */
function bindSearch(shadow: ShadowRoot): void {
  const input = shadow.querySelector<HTMLInputElement>("#hub-search");
  const results = shadow.querySelector<HTMLElement>("#hub-search-results");
  if (!input) return;

  const apply = () => {
    const query = normalizeSearchText(input.value);
    const words = query.split(" ").filter(Boolean);
    const counts = new Map<FeatureId, number>();
    for (const f of FEATURE_DEFS) counts.set(f.id, 0);

    shadow.querySelectorAll<HTMLElement>("[data-search]").forEach((card) => {
      const text = card.dataset.search ?? "";
      const match = words.every((w) => text.includes(w));
      card.classList.toggle("search-hidden", words.length > 0 && !match);
      if (words.length > 0 && match) {
        const panel = card.closest<HTMLElement>("[data-feature-panel]");
        const id = panel?.dataset.featurePanel as FeatureId | undefined;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    });
    // section titles say nothing about the cards left under them
    shadow
      .querySelectorAll<HTMLElement>("[data-search-divider]")
      .forEach((d) => d.classList.toggle("search-hidden", words.length > 0));

    const tabs = [...shadow.querySelectorAll<HTMLInputElement>('input[name="hub_tabs"]')];
    for (const tab of tabs) {
      const badge = tab.parentElement?.querySelector<HTMLElement>("[data-tab-count]");
      const n = counts.get(tab.value as FeatureId) ?? 0;
      if (!badge) continue;
      badge.textContent = words.length > 0 && n > 0 ? String(n) : "";
      badge.classList.toggle("hidden", !(words.length > 0 && n > 0));
    }

    if (results) {
      if (words.length === 0) {
        results.textContent = "";
      } else {
        const names = FEATURE_DEFS.filter((f) => (counts.get(f.id) ?? 0) > 0).map(
          (f) => `${f.name} (${counts.get(f.id)})`,
        );
        results.textContent = names.length
          ? `Matches in ${names.join(", ")}`
          : "No setting matches";
      }
    }

    if (words.length === 0) return;
    const current = tabs.find((t) => t.checked);
    if (current && (counts.get(current.value as FeatureId) ?? 0) > 0) return;
    const first = tabs.find((t) => (counts.get(t.value as FeatureId) ?? 0) > 0);
    if (first) {
      first.checked = true;
      // bindTabPanels keeps aria-selected and the tab memory on "change"
      first.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  input.addEventListener("input", apply);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !input.value) return;
    // an Escape with a query clears it; the next one closes the hub
    e.preventDefault();
    e.stopPropagation();
    input.value = "";
    apply();
  });
  shadow.addEventListener("keydown", (event) => {
    const e = event as KeyboardEvent;
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    // a "/" typed in a field is text; on a switch, a tab or a button it is
    // the shortcut
    const target = e.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        (target instanceof HTMLInputElement &&
          !["checkbox", "radio", "button", "range", "color"].includes(target.type)));
    if (typing) return;
    e.preventDefault();
    input.focus();
  });
}
