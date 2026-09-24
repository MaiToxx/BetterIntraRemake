/**
 * The tabs of the hub, one per feature: the tab button and its panel, with a
 * sticky header (feature switch, Reset) and the grid of settings. Also what
 * the header's switch and Reset button do once the modal is on the page.
 */
import { html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import RESET_SVG from "../../../assets/svg/reset.svg?raw";
import { getConfig, type ConfigKey } from "../../../core/config.ts";
import { t, tp } from "../../../core/i18n/i18n.ts";
import { EXTRAS_KEYS } from "../../profile/extras/extras.ts";
import { CLOUD_GATE, type SettingGates } from "../dependents.ts";
import {
  FEATURE_DEFS,
  FEATURE_IDS,
  HUB_SETTING_DEFS,
  type FeatureId,
} from "../hubSettings.data.ts";
import { getStoredLinks } from "../../shortcuts/shortcuts.ui.ts";
import { removeSettings, type LiveOptions } from "./context.ts";
import { renderSetting } from "./setting.ts";
import { SHORTCUTS_RELOAD_EVENT } from "./shortcuts.ts";

const GRID_COLS_CLASSES = ["", "", "md:grid-cols-2", "md:grid-cols-3"] as const;

/**
 * Where the last selected tab is kept: most settings take effect after the
 * Reload the footer asks for, and the hub used to reopen on Profile every
 * time, so iterating on Logtime meant a click per try. Session storage: the
 * tab is a place in a conversation, not a setting.
 */
export const TAB_MEMORY_KEY = "bi-hub-tab";

/** The tab to open on: the remembered one when it is still a tab, else the first. */
export function rememberedTab(): FeatureId {
  try {
    const stored = sessionStorage.getItem(TAB_MEMORY_KEY);
    if (stored && FEATURE_IDS.has(stored as FeatureId)) return stored as FeatureId;
  } catch {
    /* no session storage here */
  }
  return FEATURE_DEFS[0].id;
}

/**
 * Every tab, in FEATURE_DEFS order. A tab that is not always on is dimmed
 * while its feature is off, and a setting is drawn disabled or hidden as
 * `gates` says (see dependents.ts).
 *
 * A tab is daisyUI's radio tab: one radio group, so the browser already
 * gives it one Tab stop (the checked tab) and moves between tabs with the
 * arrow keys, which also switches the panel (`:checked + .tab-content`).
 * What it lacked was the tab semantics: role="tab" on the radio, named by
 * the feature (the icon is hidden), aria-selected kept in step by
 * bindTabPanels(), and a panel labelled by its tab.
 */
export function renderTabsContent(
  active: FeatureId[],
  gates: SettingGates,
  live: LiveOptions,
  initialTab: FeatureId = FEATURE_DEFS[0].id,
) {
  const { disabled: disabledDeps, hidden: hiddenDeps } = gates;
  return FEATURE_DEFS.map((f) => {
    const isAlwaysEnabled = !f.toggleable;
    const enabled = active.includes(f.id) || isAlwaysEnabled;
    const settings = (HUB_SETTING_DEFS[f.id] || [])
      // a switch for chair markers the campus does not have is a dead switch
      .filter((def) => !def.requiresChairMarkers || live.chairMarkers)
      .map((def) => {
        const hidden = !!(def.key && hiddenDeps.has(def.key));
        return renderSetting(
          def,
          isAlwaysEnabled ||
            (enabled &&
              !(def.key && disabledDeps.has(def.key)) &&
              !(def.requiresCloud && disabledDeps.has(CLOUD_GATE))),
          hidden,
          live,
        );
      });
    const gridColsClass =
      "cols" in f && f.cols != null
        ? (GRID_COLS_CLASSES[f.cols] ?? "md:grid-cols-3")
        : "md:grid-cols-3";

    const tabId = `hub-tab-${f.id}`;
    const panelId = `hub-panel-${f.id}`;
    const selected = f.id === initialTab;
    // FEATURE_DEFS names and descriptions are keys (msg() in hubSettings.data.ts)
    const name = t(f.name);
    // On a phone the tab names are for screen readers only (nine named tabs
    // took four rows there), and the header drops its description (wrapped,
    // it made the sticky header 119 px tall; the switch keeps it as its
    // aria-describedby).
    return html`<label class="tab flex items-center gap-2">
        <input
          type="radio"
          name="hub_tabs"
          role="tab"
          value="${f.id}"
          aria-labelledby="${tabId}"
          aria-controls="${panelId}"
          aria-selected="${selected ? "true" : "false"}"
          ?checked="${selected}"
        />
        <span class="size-4 flex items-center justify-center" aria-hidden="true">
          ${unsafeHTML(f.icon)}
        </span>
        <span id="${tabId}" class="max-sm:sr-only">${name}</span>
        <!-- how many settings of this tab match the search, empty otherwise -->
        <span class="badge badge-xs badge-primary hidden" data-tab-count></span>
      </label>
      <div
        role="tabpanel"
        id="${panelId}"
        aria-labelledby="${tabId}"
        class="tab-content bg-base-100 border-base-300 p-0 overflow-y-auto"
      >
        <div
          class="flex flex-col ${enabled || isAlwaysEnabled
            ? ""
            : "opacity-40 grayscale"}"
          data-feature-panel="${f.id}"
        >
          ${!isAlwaysEnabled
            ? html`
                <div
                  class="sticky top-0 z-20 flex items-center justify-between gap-2 bg-base-200 px-4 py-2 sm:px-6 sm:py-4 border-b border-base-300 shadow-sm"
                >
                  <div class="flex flex-col min-w-0">
                    <h2 class="text-lg font-bold leading-tight">${name}</h2>
                    <p
                      class="text-xs opacity-70 max-sm:hidden"
                      id="hub-feature-desc-${f.id}"
                    >
                      ${t(f.desc)}
                    </p>
                  </div>
                  <div class="flex items-center gap-3">
                    <button
                      class="btn btn-sm btn-outline btn-error flex items-center gap-2"
                      data-reset-feature="${f.id}"
                      aria-label="${t("Reset {name} settings", { name })}"
                    >
                      <span
                        class="size-3.5 flex items-center justify-center"
                        aria-hidden="true"
                        >${unsafeHTML(RESET_SVG)}</span
                      >
                      ${t("Reset")}
                    </button>
                    <input
                      type="checkbox"
                      class="toggle toggle-xl toggle-primary hub-feature-toggle"
                      aria-label="${t("Enable {name}", { name })}"
                      aria-describedby="hub-feature-desc-${f.id}"
                      data-id="${f.id}"
                      ?checked="${enabled}"
                    />
                  </div>
                </div>
              `
            : ""}
          <div
            class="${f.id === "about"
              ? "p-6 w-full"
              : `grid grid-cols-1 ${gridColsClass} gap-4 p-6`}"
          >
            ${settings}
          </div>
        </div>
      </div>`;
  });
}

/**
 * Wires the tabs (aria-selected follows the checked radio, whichever way it
 * got checked: click, arrow key; the checked tab is remembered for the next
 * open) and the feature switch and the Reset button of every tab header.
 */
export function bindTabPanels(shadow: ShadowRoot): void {
  const tabs = shadow.querySelectorAll<HTMLInputElement>('input[name="hub_tabs"]');
  tabs.forEach((tab) =>
    tab.addEventListener("change", () => {
      tabs.forEach((other) =>
        other.setAttribute("aria-selected", String(other.checked)),
      );
      if (!tab.checked) return;
      try {
        sessionStorage.setItem(TAB_MEMORY_KEY, tab.value);
      } catch {
        /* no session storage here */
      }
    }),
  );

  shadow.querySelectorAll("input.hub-feature-toggle").forEach((toggle: any) => {
    toggle.addEventListener("change", async () => {
      const id = toggle.dataset.id;
      const isEnabled = toggle.checked;

      const panel = shadow.querySelector(`[data-feature-panel="${id}"]`);
      panel?.classList.toggle("opacity-40", !isEnabled);
      panel?.classList.toggle("grayscale", !isEnabled);
      panel
        ?.querySelectorAll("[data-setting-key]")
        .forEach((c: any) => (c.disabled = !isEnabled));
      panel?.querySelectorAll(".card").forEach((card: any) => {
        if (isEnabled) {
          card.classList.remove("opacity-40", "grayscale");
        } else {
          card.classList.add("opacity-40", "grayscale");
        }
      });

      const currentScripts = await getConfig("ACTIVE_SCRIPTS");
      const updated = isEnabled
        ? [...currentScripts, id]
        : currentScripts.filter((f: string) => f !== id);
      await chrome.storage.local.set({
        ACTIVE_SCRIPTS: JSON.stringify(updated),
      });
    });
  });

  // The Reset button sits next to the tab's switch and used to act on the
  // first click; on Shortcuts that erased every hand-typed link, and Auto
  // push then replaced the cloud copy a second later.
  shadow.querySelectorAll("[data-reset-feature]").forEach((btn: any) => {
    btn.addEventListener("click", async () => {
      const feature = btn.dataset.resetFeature as FeatureId;
      if (!window.confirm(await resetConfirmMessage(feature))) return;
      await resetFeatureSettings(shadow, feature);
    });
  });
}

/**
 * The question a tab's Reset asks: what it deletes that the user made
 * (published profile texts, typed shortcuts), and the cloud copy an Auto
 * push would replace with the empty list.
 */
export async function resetConfirmMessage(feature: FeatureId): Promise<string> {
  const def = FEATURE_DEFS.find((f) => f.id === feature);
  const name = def ? t(def.name) : feature;
  if (feature === "profile" && (await hasPublicProfileContent())) {
    return t(
      "Reset the Profile tab? This also clears your public profile (bio, status, links, name style, effect) for everyone who visits your page.",
    );
  }
  if (feature === "shortcuts") {
    const saved = (await getStoredLinks()).filter((l) => l.name && l.url).length;
    if (saved > 0) {
      const deletes = tp(
        saved,
        "Reset the Shortcuts tab? This deletes your {n} shortcut (names, addresses, colours).",
        "Reset the Shortcuts tab? This deletes your {n} shortcuts (names, addresses, colours).",
      );
      return (await autoPushOn())
        ? `${deletes} ${t("Auto push is on: the copy in the cloud is replaced too.")}`
        : deletes;
    }
  }
  return t("Reset the {name} tab to its default settings?", { name });
}

/** Signed in with Auto push: a change reaches the cloud copy a second later. */
async function autoPushOn(): Promise<boolean> {
  const stored = await chrome.storage.local.get(["CLOUD_SYNC_ENABLED", "CLOUD_TOKEN"]);
  return stored.CLOUD_SYNC_ENABLED === true && !!stored.CLOUD_TOKEN;
}

/** True when the user published anything on their profile (text, links). */
async function hasPublicProfileContent(): Promise<boolean> {
  const stored = await chrome.storage.local.get([...EXTRAS_KEYS]);
  return EXTRAS_KEYS.some((key) => {
    const v = stored[key];
    return typeof v === "string" && v.trim() !== "";
  });
}

/** Puts a tab back to its defaults: in storage, then on its controls. */
export async function resetFeatureSettings(
  root: ShadowRoot | HTMLElement,
  featureId: FeatureId,
): Promise<void> {
  const keysToRemove = (HUB_SETTING_DEFS[featureId] ?? [])
    .map((def) => def.key)
    .filter((k): k is ConfigKey => k !== undefined);
  // removeSettings also republishes a reset public setting (look, extras)
  if (keysToRemove.length > 0) await removeSettings(keysToRemove);
  // The link editor keeps its own list: left alone it went on showing the
  // deleted links, and the next keystroke saved them back.
  if (keysToRemove.includes("SHORTCUTS_LINKS")) {
    root
      .querySelectorAll("[data-shortcuts-panel]")
      .forEach((panel) => panel.dispatchEvent(new CustomEvent(SHORTCUTS_RELOAD_EVENT)));
  }
  (HUB_SETTING_DEFS[featureId] ?? []).forEach((def) => {
    const controls = root.querySelectorAll<HTMLInputElement>(
      `[data-setting-key="${def.key}"]`,
    );
    const val = def.defaultValue ?? (def.kind === "toggle" ? false : "");

    controls.forEach((control) => {
      if (control.type === "radio") {
        control.checked = control.value === String(val);
      } else if (control.type === "checkbox") {
        control.checked = Boolean(val);
      } else {
        control.value = String(val);
      }
    });
  });
  // The controls were rewritten without a "change": the dependants (a colour
  // picker under a style now back to "default") are re-gated on this.
  root.dispatchEvent(
    new CustomEvent("bi-settings-synced", { bubbles: true, composed: true }),
  );
}
