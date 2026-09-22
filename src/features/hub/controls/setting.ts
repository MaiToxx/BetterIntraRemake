/**
 * One setting of the hub: the card around it (label, description, width on
 * the tab's grid, dimmed or hidden) and the control its kind asks for. The
 * dispatch below is the one place that maps a setting kind to its renderer.
 */
import { html, nothing } from "lit-html";
import { until } from "lit-html/directives/until.js";
import { getConfig } from "../../../core/config.ts";
import { renderCalendarPanel } from "../../calendar/calendar.ui.ts";
import { renderPresetsPanel } from "../../customize/presets.ui.ts";
import { renderCardsPanel } from "../../customize/cards.ui.ts";
import { renderAboutPanel } from "../hub.about.ts";
import {
  isLiveKey,
  normalizeSearchText,
  type HubSettingDef,
} from "../hubSettings.data.ts";
import { settingIds, type LiveOptions } from "./context.ts";
import {
  renderColor,
  renderEmoji,
  renderNumber,
  renderRadioGroup,
  renderSelect,
  renderText,
  renderTextarea,
  renderToggle,
  renderUrl,
} from "./basic.ts";
import { renderAction, renderCampusInfo } from "./actions.ts";
import { renderCardOrder } from "./card-order.ts";
import { renderFeatureCards } from "./feature-cards.ts";
import { renderRainbowPalette } from "./rainbow-palette.ts";
import { renderShortcutsPanel } from "./shortcuts.ts";
import { renderThemePreset } from "./theme-preset.ts";

/**
 * Kinds whose controls another module draws: their card becomes a group
 * named by the setting's label, so those controls are at least announced in
 * the right context. Every other kind names its own controls (basic.ts...).
 */
const PANEL_KINDS: ReadonlySet<string> = new Set([
  "shortcuts",
  "custom-presets",
  "custom-cards",
]);

/**
 * A divider is a bare title and the full-width panels (About, Calendar,
 * feature cards) draw their own frame; every other setting sits in a card.
 * The label and description get the ids of settingIds(def), which the
 * controls point at.
 */
export function renderSetting(
  def: HubSettingDef,
  enabled: boolean,
  hidden: boolean,
  live: LiveOptions,
) {
  if (def.kind === "divider") {
    return html`<div
      class="divider font-bold my-2 col-span-full opacity-70"
      data-search-divider
    >
      ${def.label}
    </div>`;
  }

  if (
    def.kind === "about" ||
    def.kind === "calendar-panel" ||
    def.kind === "feature-cards"
  ) {
    return renderSettingControl(def, enabled, live);
  }

  const COLSPAN_CLASSES = ["col-span-1", "col-span-2", "col-span-3"] as const;
  const isFullWidth =
    def.fullWidth ?? (def.kind === "url" || def.kind === "shortcuts");
  const gridClass =
    def.colSpan != null
      ? (COLSPAN_CLASSES[def.colSpan - 1] ?? "col-span-full")
      : "col-span-full";
  const ids = settingIds(def);
  const panel = PANEL_KINDS.has(def.kind);
  // most settings only take effect after the Reload of the footer; the few
  // the page applies on the spot carry no tag
  const needsReload = !!def.key && !isLiveKey(def.key);

  return html`<div
    class="card bg-base-200 shadow-sm p-3 sm:p-4 ${gridClass} ${hidden
      ? "hidden"
      : enabled
        ? ""
        : "opacity-40 grayscale"}"
    data-search="${normalizeSearchText(`${def.label} ${def.desc ?? ""}`)}"
  >
    <div
      class="flex ${isFullWidth
        ? "flex-col"
        : "flex-col sm:flex-row sm:items-center"} justify-between gap-3 sm:gap-4"
    >
      <div class="flex flex-col">
        <span class="flex items-center gap-2">
          <span class="text-sm" id="${ids.label}">${def.label}</span>
          ${needsReload
            ? html`<span
                class="badge badge-xs badge-ghost opacity-70 font-normal"
                title="Takes effect after a page reload"
                >reload</span
              >`
            : ""}
        </span>
        ${def.desc
          ? html`<span class="text-xs opacity-50" id="${ids.desc}"
              >${def.desc}</span
            >`
          : ""}
      </div>
      <div
        class="${isFullWidth ? "w-full" : "flex-none self-end sm:self-auto"}"
        role="${panel ? "group" : nothing}"
        aria-labelledby="${panel ? ids.label : nothing}"
        aria-describedby="${panel && ids.desc ? ids.desc : nothing}"
      >
        ${renderSettingControl(def, enabled, live)}
      </div>
    </div>
  </div>`;
}

/**
 * The control of one setting. Panels that load their own data come back at
 * once; every other kind waits for its stored value behind a spinner.
 */
function renderSettingControl(
  def: HubSettingDef,
  enabled: boolean,
  live: LiveOptions,
) {
  if (def.kind === "shortcuts" && def.key === "SHORTCUTS_LINKS") {
    return renderShortcutsPanel();
  }
  if (def.kind === "about") return renderAboutPanel();
  if (def.kind === "card-order") return renderCardOrder(def, enabled);
  if (def.kind === "calendar-panel") return renderCalendarPanel();
  if (def.kind === "custom-presets") return renderPresetsPanel();
  if (def.kind === "custom-cards") return renderCardsPanel();

  return until(
    (async () => {
      const value = def.key
        ? ((await getConfig(def.key)) ?? def.defaultValue ?? "")
        : (def.defaultValue ?? "");

      switch (def.kind) {
        case "feature-cards":
          return renderFeatureCards(def, enabled);
        case "toggle":
          return renderToggle(def, value, enabled);
        case "number":
          return renderNumber(def, value, enabled);
        case "select":
          return renderSelect(def, value, enabled, live);
        case "color":
          return renderColor(def, value, enabled);
        case "rainbow-palette":
          return renderRainbowPalette(def, value);
        case "radio-group":
          return renderRadioGroup(def, value, enabled, live);
        case "theme-preset":
          return renderThemePreset(def, value);
        case "url":
          return renderUrl(def, value, enabled);
        case "text":
          return renderText(def, value, enabled);
        case "textarea":
          return renderTextarea(def, value, enabled);
        case "action":
          return renderAction(def);
        case "campus-info":
          return renderCampusInfo(live);
        case "emoji":
        default:
          return renderEmoji(def, value, enabled);
      }
    })(),
    html`<div class="loading loading-spinner loading-sm"></div>`,
  );
}
