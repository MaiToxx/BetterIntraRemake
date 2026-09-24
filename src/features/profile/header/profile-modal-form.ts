/**
 * The visuals editor's form: the state it edits, the tab names, and the
 * small widgets its image tabs share (URL field with its history, fill-mode
 * radios).
 *
 * WHY a module of its own: profile.modal.ts (the dialog's lifecycle) and
 * profile-modal-tabs.ts (what each tab shows) both speak in these terms. With
 * them here, neither has to import the other's internals.
 */
import { html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { sanitizeCssUrl } from "../../../core/security/css-sanitize.ts";
import { localPreviewUrl } from "./local-preview.ts";
import LINK_SVG from "../../../assets/svg/link.svg?raw";
import { t } from "../../../core/i18n/i18n.ts";

export interface FormState {
  avatar: string;
  banner: string;
  bannerMode: string;
  bannerColor: string;
  background: string;
  backgroundMode: string;
  backgroundColor: string;
  avatarBg: string;
  decoration: string;
  avatarPosX: number;
  avatarPosY: number;
  avatarScale: number;
  badgeBg: string;
  badgeOrder: string[];
  badgeWrap: boolean;
}

export type ProfileTab = "avatar" | "banner" | "background" | "badges";

/** Merges a change into the form and re-renders the editor. */
export type FormUpdate = (updates: Partial<FormState>) => void;

/** The three tabs that edit an image, each with its own url history. */
export type ImageKey = "avatar" | "banner" | "background";
export type ImageHistory = { avatar: string[]; banner: string[]; background: string[] };

export { addToHistory } from "./image-history.ts";

function renderUrlHistory(
  history: string[],
  onSelect: (val: string) => void,
  onClear?: () => void,
) {
  if (history.length === 0) return html``;
  return html`
    <div class="flex flex-wrap gap-1 mt-2">
      ${history.map((url) => {
        // History entries are raw strings: typed here, but also restored from a
        // backup or copied back from the cloud. Unsanitised and unquoted, a
        // ")" or ";" in one ended the url() and added declarations to the
        // thumbnail (position:fixed over the page, say), and a "(" made it a
        // bad url. sanitizeCssUrl() keeps only an http(s) URL with no quote,
        // backslash or space, so inside url("...") it cannot leave the string.
        const safe = sanitizeCssUrl(url);
        const image = safe ? `background-image: url("${safe}"); ` : "";
        return html`
          <button
            type="button"
            class="rounded-lg border border-base-300 hover:border-accent"
            data-tip="${url}"
            @click="${() => onSelect(url)}"
            style="${image}background-size: cover; background-position: center; width: 2rem; height: 2rem; flex-shrink: 0; border-radius: 0.5rem; cursor: pointer;"
          ></button>
        `;
      })}
      ${onClear
        ? html`<button
            type="button"
            class="rounded-lg border border-base-300 text-xs font-bold opacity-50 hover:opacity-100 hover:border-error"
            style="width: 2rem; height: 2rem; flex-shrink: 0; cursor: pointer; background: none;"
            data-tip="${t("Clear history")}"
            @click=${onClear}
          >
            ✕
          </button>`
        : ""}
    </div>
  `;
}
/**
 * What the Upload button next to a URL field shows: nothing, a progress
 * note, or the last error, plus the file picked for this field and waiting
 * for Save. Kept by the caller between renders.
 */
export interface UploadUi {
  onFile: (file: File) => void;
  status?: string;
  busy?: boolean;
  /** Picked, previewed, uploaded on Save: `preview` is a local data: URL. */
  pending?: { name: string; preview: string };
  onDiscard?: () => void;
}

function renderPendingFile(upload: UploadUi) {
  const pending = upload.pending;
  if (!pending) return "";
  const local = localPreviewUrl(pending.preview);
  const thumb = local ? `background-image: url("${local}"); ` : "";
  return html`<div class="flex items-center gap-2 mt-1 text-xs" data-upload-pending>
    <span
      class="rounded border border-base-300 shrink-0"
      style="${thumb}background-size: cover; background-position: center; width: 2rem; height: 2rem;"
    ></span>
    <span class="min-w-0 truncate opacity-80"
      >${t("{name}: uploads when you save", { name: pending.name })}</span
    >
    ${upload.onDiscard
      ? html`<button
          type="button"
          class="btn btn-ghost btn-xs shrink-0"
          aria-label="${t("Discard {name}", { name: pending.name })}"
          ?disabled="${!!upload.busy}"
          @click="${upload.onDiscard}"
        >
          ✕
        </button>`
      : ""}
  </div>`;
}

export function renderUrlField(
  label: string,
  value: string,
  onInput: (val: string) => void,
  history: string[] = [],
  onClearHistory?: () => void,
  upload?: UploadUi,
) {
  return html`
    <div class="form-control w-full">
      <label class="label py-1">
        <span class="label-text opacity-80">${label}</span>
      </label>
      <div class="flex flex-wrap gap-2 items-stretch">
        <label
          class="input input-accent validator flex items-center gap-2 flex-1 min-w-40"
        >
          <span class="h-[1em] opacity-50 flex items-center justify-center"
            >${unsafeHTML(LINK_SVG)}</span
          >
          <input
            type="url"
            required
            placeholder="https://example.com/image.png"
            .value="${value}"
            pattern="^(https?://)?.*"
            class="grow"
            @input="${(e: Event) =>
              onInput((e.target as HTMLInputElement).value)}"
          />
        </label>
        ${upload
          ? html`<label
              class="btn btn-sm btn-outline btn-accent self-center ${upload.busy ? "btn-disabled" : ""}"
              title="${t(
                "Choose an image on this computer (2 MB at most; bigger JPEG photos are shrunk). It is uploaded when you save.",
              )}"
            >
              ${t("Upload")}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                class="hidden"
                data-upload-input
                ?disabled="${!!upload.busy}"
                @change="${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const file = input.files?.[0];
                  input.value = "";
                  if (file) upload.onFile(file);
                }}"
              />
            </label>`
          : ""}
      </div>
      ${upload ? renderPendingFile(upload) : ""}
      ${upload?.status
        ? html`<p class="text-xs mt-1 ${upload.busy ? "opacity-70" : "text-error"}" data-upload-status>
            ${upload.status}
          </p>`
        : ""}
      ${renderUrlHistory(history, onInput, onClearHistory)}
    </div>
  `;
}

export function renderModeRadios(
  name: string,
  currentValue: string,
  onChange: (val: string) => void,
) {
  const modes: [string, string][] = [
    ["fill", t("Fill")],
    ["fit", t("Fit")],
    ["stretch", t("Stretch")],
    ["center", t("Center")],
    ["tile", t("Tile")],
  ];
  return html`
    <div class="join w-full mt-4">
      ${modes.map(
        ([m, label]) =>
          html`<input
            type="radio"
            name="${name}"
            class="btn btn-sm join-item flex-1"
            aria-label="${label}"
            value="${m}"
            ?checked="${currentValue === m}"
            @change="${(e: Event) =>
              onChange((e.target as HTMLInputElement).value)}"
          />`,
      )}
    </div>
  `;
}
