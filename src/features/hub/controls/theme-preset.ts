/**
 * Theme (Profile tab): one swatch per preset, painted with the page background
 * and a band of the accent, so that two themes with the same accent can be
 * told apart. Picking one saves it, repaints the hub in that theme at once,
 * and flips the hub's light/dark switch when the theme sits on the other side
 * (the page follows the theme's own mode, see theme-manager.ts).
 */
import { html, nothing } from "lit-html";
import { t } from "../../../core/i18n/i18n.ts";
import { THEMES } from "../../../core/theme/theme-manager.ts";
import type { HubSettingDef } from "../hubSettings.data.ts";
import { saveSetting, settingIds } from "./context.ts";

/**
 * The title of a group of swatches, translated. The theme names themselves
 * stay as written in every language; so does a title this list does not know
 * (theme-options.ts is generated).
 */
function groupTitle(label: string): string {
  switch (label) {
    case "Dark":
      return t("Dark");
    case "Light":
      return t("Light");
    case "Dark · Palettes":
      return t("Dark · Palettes");
    case "Light · Palettes":
      return t("Light · Palettes");
    default:
      return label;
  }
}

export function renderThemePreset(def: HubSettingDef, value: unknown) {
  const ids = settingIds(def);
  // Every swatch is a radio named by its theme (aria-label, which daisyUI also
  // prints on it); the group carries the setting's label.
  return html`<div
    class="flex flex-wrap gap-1 w-full"
    role="radiogroup"
    aria-labelledby="${ids.label}"
    aria-describedby="${ids.desc ?? nothing}"
  >
    ${(def.options ?? []).map((o) => {
      if ((o as { divider?: boolean }).divider) {
        return html`<div class="w-full h-px bg-base-300 my-1"></div>`;
      }
      if (
        (o as { label?: string }).label &&
        !(o as { value?: string }).value
      ) {
        return html`<div
          class="w-full text-xs font-bold uppercase opacity-50 pt-1"
        >
          ${groupTitle(o.label ?? "")}
        </div>`;
      }
      const hsl = (o as { color?: string }).color ?? "199 89% 48%";
      const bg = (o as { bg?: string }).bg ?? hsl;
      const selected = String(o.value) === String(value);
      // the label sits on the background half of the swatch
      const lightness = parseInt(bg.split(" ")[2] ?? "50");
      const textColor =
        lightness > 55 ? "hsl(0 0% 12%)" : "hsl(0 0% 96%)";
      return html`<input
        type="radio"
        name="${def.key}"
        class="btn btn-sm flex-none"
        aria-label="${o.label}"
        value="${o.value}"
        data-hsl="${hsl}"
        style="background: linear-gradient(to top, hsl(${hsl}) 0 5px, hsl(${bg}) 5px); color: ${textColor}; border: 2px solid ${selected
          ? "#fff"
          : "transparent"}; outline: ${selected
          ? "2px solid hsl(" + hsl + ")"
          : "none"}; outline-offset: 2px;"
        ?checked="${selected}"
        @change="${(e: Event) => {
          const input = e.target as HTMLInputElement;
          if (!input.checked) return;
          saveSetting(def.key!, input.value);
          const group = input.closest(".flex")!;
          group
            .querySelectorAll(`input[name="${def.key}"]`)
            .forEach((r) => {
              const el = r as HTMLInputElement;
              const h = el.dataset.hsl ?? "199 89% 48%";
              el.style.border = el.checked
                ? "2px solid #fff"
                : "2px solid transparent";
              el.style.outline = el.checked
                ? `2px solid hsl(${h})`
                : "none";
              el.style.outlineOffset = el.checked ? "2px" : "";
            });
          const root = input.getRootNode() as ShadowRoot;
          const container = root.querySelector(
            "[data-theme]",
          ) as HTMLElement;
          if (container)
            container.setAttribute("data-theme", input.value);
          const toggle = root.querySelector(
            "#hub-theme-toggle",
          ) as HTMLInputElement;
          if (toggle) {
            const isLight =
              input.value === "light" || !!THEMES[input.value]?.light;
            if (toggle.checked === isLight) {
              toggle.checked = !isLight;
              chrome.storage.local.set({
                BETTER_INTRA_THEME: isLight ? "light" : "dark",
              });
            }
          }
        }}"
      />`;
    })}
  </div>`;
}
