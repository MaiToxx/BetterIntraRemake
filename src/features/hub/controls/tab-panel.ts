/**
 * The tabs of the hub, one per feature: the tab button and its panel, with a
 * sticky header (feature switch, Reset), the "connect your 42 account" gate
 * for cloud features, and the grid of settings. Also what the header's switch
 * and Reset button do once the modal is on the page.
 */
import { html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import FORTY_TWO_SVG from "../../../assets/svg/42_Logo.svg?raw";
import RESET_SVG from "../../../assets/svg/reset.svg?raw";
import { getConfig, type ConfigKey } from "../../../core/config.ts";
import { clearAuthFailed, loginWith42 } from "../../account/account.ts";
import { EXTRAS_KEYS } from "../../profile/extras/extras.ts";
import { CLOUD_GATE, type SettingGates } from "../dependents.ts";
import {
  FEATURE_DEFS,
  HUB_SETTING_DEFS,
  type FeatureId,
} from "../hubSettings.data.ts";
import { removeSettings, type LiveOptions } from "./context.ts";
import { renderSetting } from "./setting.ts";

const GRID_COLS_CLASSES = ["", "", "md:grid-cols-2", "md:grid-cols-3"] as const;

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
) {
  const { disabled: disabledDeps, hidden: hiddenDeps } = gates;
  return FEATURE_DEFS.map((f, idx) => {
    const isAlwaysEnabled =
      f.id === "about" ||
      f.id === "calendar" ||
      f.id === "advanced" ||
      f.id === "customize" ||
      f.id === "extras";
    const enabled = active.includes(f.id) || isAlwaysEnabled;
    const cloudDisabled =
      "requiresCloud" in f &&
      (f as { requiresCloud?: boolean }).requiresCloud &&
      disabledDeps.has(CLOUD_GATE);
    const settings = (HUB_SETTING_DEFS[f.id] || []).map((def) => {
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
    return html`<label class="tab flex items-center gap-2">
        <input
          type="radio"
          name="hub_tabs"
          role="tab"
          aria-labelledby="${tabId}"
          aria-controls="${panelId}"
          aria-selected="${idx === 0 ? "true" : "false"}"
          ?checked="${idx === 0}"
        />
        <span class="size-4 flex items-center justify-center" aria-hidden="true">
          ${unsafeHTML(f.icon)}
        </span>
        <span id="${tabId}">${f.name}</span>
      </label>
      <div
        role="tabpanel"
        id="${panelId}"
        aria-labelledby="${tabId}"
        class="tab-content bg-base-100 border-base-300 p-0 overflow-y-auto"
      >
        <div
          class="flex flex-col ${enabled || isAlwaysEnabled
            ? cloudDisabled
              ? "opacity-40 grayscale"
              : ""
            : "opacity-40 grayscale"}"
          data-feature-panel="${f.id}"
        >
          ${!isAlwaysEnabled
            ? html`
                <div
                  class="sticky top-0 z-20 flex items-center justify-between bg-base-200 px-6 py-4 border-b border-base-300 shadow-sm"
                >
                  <div class="flex flex-col">
                    <h2 class="text-lg font-bold leading-tight">${f.name}</h2>
                    <p class="text-xs opacity-70" id="hub-feature-desc-${f.id}">
                      ${f.desc}
                    </p>
                  </div>
                  <div class="flex items-center gap-3">
                    <button
                      class="btn btn-sm btn-outline btn-error flex items-center gap-2"
                      data-reset-feature="${f.id}"
                      aria-label="Reset ${f.name} settings"
                    >
                      <span
                        class="size-3.5 flex items-center justify-center"
                        aria-hidden="true"
                        >${unsafeHTML(RESET_SVG)}</span
                      >
                      Reset
                    </button>
                    <input
                      type="checkbox"
                      class="toggle toggle-xl toggle-primary hub-feature-toggle"
                      aria-label="Enable ${f.name}"
                      aria-describedby="hub-feature-desc-${f.id}"
                      data-id="${f.id}"
                      ?checked="${enabled && !cloudDisabled}"
                      ?disabled="${cloudDisabled}"
                    />
                  </div>
                </div>
              `
            : ""}
          ${cloudDisabled
            ? html`<div
                class="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center"
              >
                <span
                  class="size-14 opacity-40 flex items-center justify-center [&_path]:fill-current"
                  aria-hidden="true"
                  >${unsafeHTML(FORTY_TWO_SVG)}</span
                >
                <p class="opacity-50 max-w-72 text-sm">
                  Connect your 42 account to unlock this feature.
                </p>
                <button
                  type="button"
                  class="btn bg-[#00babc] text-white border-none hover:bg-[#1fd2d4] h-12 text-base flex items-center justify-center gap-3 transition-colors duration-200"
                  aria-label="Connect with 42"
                  @click="${async () => {
                    loginWith42(async () => {
                      await clearAuthFailed();
                      window.location.reload();
                    });
                  }}"
                >
                  <span class="font-bold tracking-wide">Connect with</span>
                  <span
                    class="size-8 flex items-center justify-center [&_path]:fill-current"
                    aria-hidden="true"
                  >
                    ${unsafeHTML(FORTY_TWO_SVG)}
                  </span>
                </button>
              </div>`
            : html`<div
                class="${f.id === "about"
                  ? "p-6 w-full"
                  : `grid grid-cols-1 ${gridColsClass} gap-4 p-6`}"
              >
                ${settings}
              </div>`}
        </div>
      </div>`;
  });
}

/**
 * Wires the tabs (aria-selected follows the checked radio, whichever way it
 * got checked: click, arrow key) and the feature switch and the Reset button
 * of every tab header.
 */
export function bindTabPanels(shadow: ShadowRoot): void {
  const tabs = shadow.querySelectorAll<HTMLInputElement>('input[name="hub_tabs"]');
  tabs.forEach((tab) =>
    tab.addEventListener("change", () =>
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t.checked))),
    ),
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

  shadow.querySelectorAll("[data-reset-feature]").forEach((btn: any) => {
    btn.addEventListener("click", async () => {
      const feature = btn.dataset.resetFeature as FeatureId;
      if (feature === "profile" && (await hasPublicProfileContent())) {
        const ok = window.confirm(
          "Reset the Profile tab? This also clears your public profile (bio, status, links, name style, effect) for everyone who visits your page.",
        );
        if (!ok) return;
      }
      await resetFeatureSettings(shadow, feature);
    });
  });
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
async function resetFeatureSettings(
  root: ShadowRoot | HTMLElement,
  featureId: FeatureId,
): Promise<void> {
  const keysToRemove = (HUB_SETTING_DEFS[featureId] ?? [])
    .map((def) => def.key)
    .filter((k): k is ConfigKey => k !== undefined);
  // removeSettings also republishes a reset public setting (look, extras)
  if (keysToRemove.length > 0) await removeSettings(keysToRemove);
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
}
