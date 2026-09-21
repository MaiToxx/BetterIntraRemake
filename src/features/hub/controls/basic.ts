/**
 * The plain controls of the settings hub, one per simple setting kind:
 * toggle, number, select, colour, radio group, url, text, textarea and
 * emoji. Each shows the stored value and saves on change; setting.ts draws
 * the card around it. The text control also checks public profile links as
 * they are typed.
 */
import { html, nothing } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import LINK_SVG from "../../../assets/svg/link.svg?raw";
import { CLUSTERS } from "../../campus/campus.ts";
import type { LinkKind } from "../../profile/extras/extras.ts";
import { normalizeLink } from "../../profile/extras/extras-sanitize.ts";
import type { HubSettingDef } from "../hubSettings.data.ts";
import { saveSetting, type LiveOptions } from "./context.ts";

/** Only the shapes normalizeLink() accepts are published: say so live. */
const LINK_HINTS: Record<string, string> = {
  github: "Not recognised. Use your user name, or the URL of your GitHub profile.",
  gitlab: "Not recognised. Use your user name, or the URL of your GitLab profile.",
  linkedin: "Not recognised. Use your public identifier, or the URL of your profile.",
  website: "Not recognised. Use a full https address, e.g. https://example.com.",
  discord: "Not recognised. Use your Discord handle, e.g. student or student#0001.",
};

function linkFieldIsValid(kind: LinkKind, value: string): boolean {
  return value.trim() === "" || normalizeLink(kind, value) !== null;
}

/** Shows or hides the hint under a link field as the user types. */
function checkLinkField(def: HubSettingDef) {
  return (e: Event) => {
    const input = e.target as HTMLInputElement;
    const ok = linkFieldIsValid(def.linkKind!, input.value);
    input.classList.toggle("input-error", !ok);
    const hint = input.parentElement?.querySelector<HTMLElement>("[data-link-hint]");
    if (hint) hint.hidden = ok;
  };
}

/** <input type="number"> gives a string: store a number when it is one. */
function numericValue(raw: string): unknown {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? n : raw;
}

/** PROFILE_EVENT_TYPE_FILTER offers the fetched event types after "Show All". */
function eventTypeChoices(live: LiveOptions) {
  return [{ label: "Show All", value: "all" }, ...live.eventTypes];
}

export function renderToggle(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
) {
  return html`<input
    type="checkbox"
    class="toggle toggle-lg toggle-accent"
    data-setting-key="${def.key}"
    ?checked="${Boolean(value)}"
    ?disabled="${!enabled}"
    @change="${(e: Event) =>
      saveSetting(def.key!, (e.target as HTMLInputElement).checked)}"
  />`;
}

export function renderNumber(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
) {
  const showEuroSuffix =
    def.key === "LOGTIME_EMOJI_RATE" ||
    def.key === "LOGTIME_EMOJI_DIVISOR" ||
    def.key === "LOGTIME_MAX_EARNINGS";

  return showEuroSuffix
    ? html`<label
        class="input input-accent w-24 flex items-center gap-1"
      >
        <input
          type="number"
          class="w-full"
          min="${def.min ?? nothing}"
          max="${def.max ?? nothing}"
          step="${def.step ?? nothing}"
          .value="${String(value)}"
          data-setting-key="${def.key}"
          ?disabled="${!enabled}"
          @change="${(e: Event) =>
            saveSetting(
              def.key!,
              numericValue((e.target as HTMLInputElement).value),
            )}"
        />
        <span class="opacity-70">€</span>
      </label>`
    : html`<input
        type="number"
        class="input input-accent w-24"
        min="${def.min ?? nothing}"
        max="${def.max ?? nothing}"
        step="${def.step ?? nothing}"
        .value="${String(value)}"
        data-setting-key="${def.key}"
        ?disabled="${!enabled}"
        @change="${(e: Event) =>
          saveSetting(def.key!, numericValue((e.target as HTMLInputElement).value))}"
      />`;
}

export function renderSelect(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
  live: LiveOptions,
) {
  const options =
    def.key === "CLUSTERS_CAMPUS" && live.campuses.length > 0
      ? live.campuses
      : def.key === "PROFILE_EVENT_TYPE_FILTER" && live.eventTypes.length > 0
        ? eventTypeChoices(live)
        : def.key === "CLUSTERS_DEFAULT_ID" && CLUSTERS.length > 0
          ? CLUSTERS.map((c) => ({
              label: c.name.toUpperCase(),
              value: c.id,
            }))
          : (def.options ?? []);
  return html`<select
    class="select select-accent w-44"
    data-setting-key="${def.key}"
    ?disabled="${!enabled}"
    @change="${(e: Event) =>
      saveSetting(def.key!, (e.target as HTMLSelectElement).value)}"
    @mousedown="${(e: Event) => e.stopPropagation()}"
    @click="${(e: Event) => e.stopPropagation()}"
  >
    ${options.map(
      (o) =>
        html`<option
          value="${o.value}"
          ?selected="${String(o.value) === String(value)}"
        >
          ${o.label}
        </option>`,
    )}
  </select>`;
}

export function renderColor(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
) {
  return html`<input
    type="color"
    class="input input-accent p-1 w-20 h-10"
    .value="${String(value)}"
    data-setting-key="${def.key}"
    ?disabled="${!enabled}"
    @change="${(e: Event) =>
      saveSetting(def.key!, (e.target as HTMLInputElement).value)}"
  />`;
}

export function renderRadioGroup(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
  live: LiveOptions,
) {
  const options =
    def.key === "PROFILE_EVENT_TYPE_FILTER" && live.eventTypes.length > 0
      ? eventTypeChoices(live)
      : (def.options ?? []);
  return html`<div class="join">
    ${options.map(
      (o) =>
        html`<input
          type="radio"
          name="${def.key}"
          class="join-item btn btn-outline border-base-content/20"
          aria-label="${o.label}"
          value="${o.value}"
          ?checked="${o.value === value}"
          data-setting-key="${def.key}"
          ?disabled="${!enabled}"
          @change="${(e: Event) =>
            saveSetting(
              def.key!,
              (e.target as HTMLInputElement).value,
            )}"
        />`,
    )}
  </div>`;
}

export function renderUrl(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
) {
  return html`<div class="w-full">
    <label
      class="input input-accent validator flex items-center gap-2 w-full"
    >
      <span class="h-[1em] opacity-50 flex items-center justify-center"
        >${unsafeHTML(LINK_SVG)}</span
      >
      <input
        type="url"
        required
        placeholder="https://beemovie.com/beemovie.gif"
        .value="${String(value)}"
        data-setting-key="${def.key}"
        ?disabled="${!enabled}"
        pattern="^(https?://)?.*"
        class="grow"
        @change="${(e: Event) =>
          saveSetting(def.key!, (e.target as HTMLInputElement).value)}"
      />
    </label>
  </div>`;
}

export function renderText(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
) {
  // fullWidth: renderSetting stacks the label over a w-full wrapper,
  // the input only has to fill it. `nothing` drops the attribute, a
  // def without maxLength keeps an unlimited input.
  const input = html`<input
    type="text"
    class="input input-accent ${def.fullWidth ? "w-full" : "w-60"}"
    placeholder="${def.placeholder || ""}"
    maxlength="${def.maxLength ?? nothing}"
    .value="${String(value || "")}"
    data-setting-key="${def.key}"
    ?disabled="${!enabled}"
    @input="${def.linkKind ? checkLinkField(def) : nothing}"
    @change="${(e: Event) =>
      saveSetting(def.key!, (e.target as HTMLInputElement).value)}"
  />`;
  if (!def.linkKind) return input;
  // A link the sanitizer cannot read is dropped silently everywhere
  // else: say so while it is being typed.
  return html`<div
    class="flex flex-col gap-1 ${def.fullWidth ? "w-full" : ""}"
  >
    ${input}
    <span
      data-link-hint
      class="text-xs text-error leading-tight"
      ?hidden="${linkFieldIsValid(def.linkKind, String(value || ""))}"
      >${LINK_HINTS[def.linkKind]}</span
    >
  </div>`;
}

export function renderTextarea(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
) {
  return html`<textarea
    class="textarea textarea-accent w-full font-mono text-xs leading-snug"
    rows="8"
    spellcheck="false"
    placeholder="${def.placeholder || ""}"
    .value="${String(value || "")}"
    data-setting-key="${def.key}"
    ?disabled="${!enabled}"
    @change="${(e: Event) =>
      saveSetting(def.key!, (e.target as HTMLTextAreaElement).value)}"
  ></textarea>`;
}

export function renderEmoji(
  def: HubSettingDef,
  value: unknown,
  enabled: boolean,
) {
  return html`<input
    type="text"
    class="input input-accent w-30 text-center text-xl"
    placeholder="${def.placeholder || "🐝"}"
    maxlength="${def.maxLength ?? 6}"
    .value="${String(value || "")}"
    data-setting-key="${def.key}"
    ?disabled="${!enabled}"
    @change="${(e: Event) =>
      saveSetting(def.key!, (e.target as HTMLInputElement).value)}"
  />`;
}
