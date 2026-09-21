/**
 * Theme accent (Profile tab): one swatch per daisyUI theme. Picking one saves
 * it, repaints the hub in that theme at once, and flips the hub's light/dark
 * switch when the theme sits on the other side.
 */
import { html } from "lit-html";
import { THEMES } from "../../../core/theme/theme-manager.ts";
import type { HubSettingDef } from "../hubSettings.data.ts";
import { saveSetting } from "./context.ts";

export function renderThemePreset(def: HubSettingDef, value: unknown) {
  return html`<div class="flex flex-wrap gap-1 w-full">
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
          ${o.label}
        </div>`;
      }
      const hsl = (o as { color?: string }).color ?? "199 89% 48%";
      const selected = String(o.value) === String(value);
      const parts = hsl.split(" ");
      const lightness = parseInt(parts[2] ?? "50");
      const textColor =
        lightness > 50 ? "hsl(0 0% 10%)" : "hsl(0 0% 100%)";
      return html`<input
        type="radio"
        name="${def.key}"
        class="btn btn-sm flex-none"
        aria-label="${o.label}"
        value="${o.value}"
        data-hsl="${hsl}"
        style="background-color: hsl(${hsl}); color: ${textColor}; border: 2px solid ${selected
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
