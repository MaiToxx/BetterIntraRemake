/**
 * Rainbow colours (Logtime tab): a dropdown of gradient palettes, each shown
 * as a swatch of its colours. Saves as soon as one is picked.
 */
import { html, nothing } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import CHEVRON_DOWN_SVG from "../../../assets/svg/chevron-down.svg?raw";
import type { HubSettingDef } from "../hubSettings.data.ts";
import { saveSetting, settingIds } from "./context.ts";

export function renderRainbowPalette(def: HubSettingDef, value: unknown) {
  const options = def.options ?? [];
  const current =
    options.find((o) => o.value === value) ??
    (options[0] as (typeof options)[number]);
  // Read as "<setting label> <picked palette>": the swatch says nothing to a
  // screen reader, and the palette name alone does not say what it is for.
  const ids = settingIds(def);
  const currentId = `${ids.label}-current`;
  return html`<div class="w-full">
    <details
      class="dropdown"
      style="position: relative; position-area: auto !important;"
      @mousedown="${(e: Event) => e.stopPropagation()}"
      @click="${(e: Event) => e.stopPropagation()}"
    >
      <summary
        class="btn btn-sm btn-outline flex items-center gap-2 justify-between w-full border-base-content/30"
        data-tip="${current.label}"
        aria-labelledby="${ids.label} ${currentId}"
        aria-describedby="${ids.desc ?? nothing}"
      >
        <span
          class="h-3 flex-1 rounded-full border border-base-300"
          style="background: linear-gradient(90deg, ${current.color});"
          aria-hidden="true"
        ></span>
        <span class="opacity-80 text-xs" id="${currentId}"
          >${current.label}</span
        >
        <span
          class="size-3 shrink-0 opacity-60 flex items-center justify-center"
          aria-hidden="true"
          >${unsafeHTML(
            CHEVRON_DOWN_SVG.replace(
              "<svg",
              '<svg width="12" height="12"',
            ),
          )}</span
        >
      </summary>
      <ul
        class="menu menu-sm dropdown-content z-20 mb-2 rounded-box bg-base-100 p-1 shadow-xl"
        style="bottom: 100% !important; right: 0 !important; left: auto !important; transform-origin: bottom; width:max-content; min-width:14rem;"
      >
        ${options.map(
          (o) =>
            html`<li>
              <button
                type="button"
                class="flex items-center gap-2 whitespace-nowrap ${o.value ===
                value
                  ? "menu-active"
                  : ""}"
                @click="${(e: Event) => {
                  saveSetting(def.key!, o.value ?? "");
                  (e.currentTarget as HTMLElement)
                    .closest("details")
                    ?.removeAttribute("open");
                }}"
              >
                <span
                  class="h-3 w-10 rounded-full border border-base-300"
                  style="background: linear-gradient(90deg, ${o.color});"
                  aria-hidden="true"
                ></span>
                <span>${o.label}</span>
              </button>
            </li>`,
        )}
      </ul>
    </details>
  </div>`;
}
