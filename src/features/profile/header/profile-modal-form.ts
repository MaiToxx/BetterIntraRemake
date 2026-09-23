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
import LINK_SVG from "../../../assets/svg/link.svg?raw";

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

/** Puts `url` first in a url history of at most ten distinct entries. */
export function addToHistory(url: string, history: string[]): string[] {
  if (!url) return history;
  const filtered = history.filter((h) => h !== url);
  return [url, ...filtered].slice(0, 10);
}

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
            data-tip="Clear history"
            @click=${onClear}
          >
            ✕
          </button>`
        : ""}
    </div>
  `;
}
export function renderUrlField(
  label: string,
  value: string,
  onInput: (val: string) => void,
  history: string[] = [],
  onClearHistory?: () => void,
) {
  return html`
    <div class="form-control w-full">
      <label class="label py-1">
        <span class="label-text opacity-80">${label}</span>
      </label>
      <div class="flex gap-2 items-stretch">
        <label
          class="input input-accent validator flex items-center gap-2 flex-1"
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
      </div>
      ${renderUrlHistory(history, onInput, onClearHistory)}
    </div>
  `;
}

export function renderModeRadios(
  name: string,
  currentValue: string,
  onChange: (val: string) => void,
) {
  const modes = ["fill", "fit", "stretch", "center", "tile"];
  return html`
    <div class="join w-full mt-4">
      ${modes.map(
        (m) =>
          html`<input
            type="radio"
            name="${name}"
            class="btn btn-sm join-item flex-1"
            aria-label="${m.charAt(0).toUpperCase() + m.slice(1)}"
            value="${m}"
            ?checked="${currentValue === m}"
            @change="${(e: Event) =>
              onChange((e.target as HTMLInputElement).value)}"
          />`,
      )}
    </div>
  `;
}
