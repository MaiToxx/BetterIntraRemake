/**
 * Feature cards (Extras tab): each add-on is a card with its own switch and,
 * for some, a sub-switch that depends on the add-on or on the cloud account.
 * The def only lists the cards: their keys are read here, when the tab draws.
 */
import { html, nothing } from "lit-html";
import { getConfig } from "../../../core/config.ts";
import {
  normalizeSearchText,
  type FeatureCardOption,
  type HubSettingDef,
} from "../hubSettings.data.ts";
import { saveSetting } from "./context.ts";

export async function renderFeatureCards(
  def: HubSettingDef,
  enabled: boolean,
) {
  const cloudToken = await getConfig("CLOUD_TOKEN");
  const cards = [];
  for (const opt of def.options ?? []) {
    const key = opt.value ?? "";
    cards.push({
      opt,
      value: key ? ((await getConfig(key as never)) ?? false) : false,
      subValue: opt.subToggle
        ? ((await getConfig(opt.subToggle.value as never)) ?? false)
        : false,
      disabled: !!(
        (opt.dependsOn && !(await getConfig(opt.dependsOn as never))) ||
        (opt.requiresCloud && !cloudToken)
      ),
      subDisabled: !!(
        (opt.subToggle?.requiresCloud && !cloudToken) ||
        (opt.subToggle?.dependsOn &&
          !(await getConfig(opt.subToggle.dependsOn as never)))
      ),
      subCloudDisabled: !!(opt.subToggle?.requiresCloud && !cloudToken),
    });
  }
  return html`<div class="grid grid-cols-2 gap-4 w-full col-span-full">
    ${cards.map((c) => renderFeatureCard({ ...c, enabled }))}
  </div>`;
}

const FEATURE_CARD_COLORS: Record<string, string> = {
  warning: "var(--color-warning)",
  info: "var(--color-info)",
  success: "var(--color-success)",
  error: "var(--color-error)",
  primary: "var(--color-primary)",
};

function renderFeatureCard(params: {
  opt: FeatureCardOption;
  value: boolean;
  subValue: boolean;
  disabled: boolean;
  subDisabled: boolean;
  /** The part of subDisabled the card's own switch cannot lift. */
  subCloudDisabled: boolean;
  enabled: boolean;
}): ReturnType<typeof html> {
  const { opt, value, subValue, disabled, subDisabled, subCloudDisabled, enabled } =
    params;
  // The switches point at the card's own title and text (the tab's grid is
  // one shadow root, and each key is on one card only, so ids are unique).
  const id = `hub-fc-${opt.value}`;
  const subId = opt.subToggle ? `hub-fc-${opt.subToggle.value}` : "";
  // the sub-switch depends on the card's own switch: it follows it at once,
  // not at the next open of the hub
  const subFollowsParent = opt.subToggle?.dependsOn === opt.value;
  const onParentChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    saveSetting(opt.value!, input.checked);
    if (!subFollowsParent) return;
    const row = input
      .closest(".card")
      ?.querySelector<HTMLElement>("[data-sub-toggle-row]");
    const sub = row?.querySelector<HTMLInputElement>("input");
    const off = !input.checked || subCloudDisabled;
    row?.classList.toggle("opacity-40", off);
    row?.classList.toggle("grayscale", off);
    if (sub) sub.disabled = !enabled || off;
  };
  return html`
    <div
      class="card bg-base-200 shadow-sm p-4 flex flex-col gap-3 border border-t-4 ${disabled
        ? "opacity-40 grayscale"
        : ""}"
      style="border-top-color: ${FEATURE_CARD_COLORS[opt.color ?? ""] ??
      "var(--color-primary)"}"
      data-search="${normalizeSearchText(
        [opt.label, opt.desc, opt.subToggle?.label, opt.subToggle?.desc]
          .filter(Boolean)
          .join(" "),
      )}"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex flex-col gap-1">
          <h3 class="font-bold text-base" id="${id}-label">${opt.label}</h3>
          ${opt.desc
            ? html`<p class="text-xs opacity-70" id="${id}-desc">${opt.desc}</p>`
            : ""}
        </div>
        <input
          type="checkbox"
          class="toggle ${opt.big
            ? "toggle-xl toggle-primary"
            : "toggle-lg toggle-accent"}"
          data-setting-key="${opt.value}"
          aria-labelledby="${id}-label"
          aria-describedby="${opt.desc ? `${id}-desc` : nothing}"
          ?checked="${Boolean(value)}"
          ?disabled="${!enabled || disabled}"
          @change="${onParentChange}"
        />
      </div>
      ${opt.subToggle
        ? html`<div class="divider gap-0" style="margin-top:auto"></div>
            <div
              class="flex items-center justify-between gap-2 ${subDisabled
                ? "opacity-40 grayscale"
                : ""}"
              data-sub-toggle-row
            >
              <div
                class="flex flex-col justify-center gap-1"
                style="min-height: 3.5rem"
              >
                <span class="text-sm font-semibold leading-5" id="${subId}-label"
                  >${opt.subToggle.label}</span
                >
                ${opt.subToggle.desc
                  ? html`<p
                      class="text-xs opacity-70 leading-4 line-clamp-2"
                      id="${subId}-desc"
                    >
                      ${opt.subToggle.desc}
                    </p>`
                  : ""}
              </div>
              <input
                type="checkbox"
                class="toggle toggle-accent"
                data-setting-key="${opt.subToggle.value}"
                aria-labelledby="${subId}-label"
                aria-describedby="${opt.subToggle.desc ? `${subId}-desc` : nothing}"
                ?checked="${Boolean(subValue)}"
                ?disabled="${!enabled || disabled || subDisabled}"
                @change="${(e: Event) =>
                  saveSetting(
                    opt.subToggle!.value,
                    (e.target as HTMLInputElement).checked,
                  )}"
              />
            </div>`
        : ""}
    </div>
  `;
}
