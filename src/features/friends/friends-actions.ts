/**
 * The floating action cluster in the panel's bottom corner: the add-friend
 * form (which also holds the button that enters delete mode) and, in delete
 * mode, the "N selected / Delete / Cancel" bar. Shown only once connected.
 */
import { html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { WidgetState } from "./friends-widget-state.ts";
import { svgIcon } from "./friends-format.ts";
import TRASH_SVG from "../../assets/svg/trash.svg?raw";
import PLUS_SVG from "../../assets/svg/plus.svg?raw";

function renderDeleteBar(state: WidgetState) {
  return html`<div class="friends-delete-bar">
    <span
      class="badge badge-error badge-md font-bold shrink-0"
      style="border:3px solid color-mix(in oklab, var(--color-error) 55%, transparent);border-radius:0.75rem;height:auto;padding-block:0.15rem;font-weight:600;"
      >${state.selected.length} selected</span
    >
    <button
      type="button"
      class="btn btn-sm btn-error flex-1 font-bold"
      @click="${state.onConfirmDelete}"
      ?disabled="${state.selected.length === 0}"
    >
      Delete
    </button>
    <button
      type="button"
      class="btn btn-sm btn-ghost"
      @click="${state.onCancelDelete}"
    >
      Cancel
    </button>
  </div>`;
}

/**
 * Collapsed: a single "+" button. Expanded: delete-mode button, login input,
 * Add and close, with the last error above them.
 */
function renderAddForm(state: WidgetState) {
  return html`<div class="flex flex-col items-end gap-2">
    ${state.addError
      ? html`<p class="text-error text-sm px-0.5">
          ${state.addError}
        </p>`
      : ""}
    <div
      class="friends-add-expand ${state.addOpen
        ? ""
        : "closed"}"
    >
      ${state.addOpen
        ? html`<button
            type="button"
            class="btn btn-circle btn-md btn-error"
            data-tip="Delete friend"
            @click="${state.onDeleteMode}"
            ?disabled="${state.friends.length === 0}"
            aria-label="Delete friends"
          >
            <span
              class="w-5 h-5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
              >${unsafeHTML(svgIcon(TRASH_SVG))}</span
            >
          </button>`
        : ""}
      ${state.addOpen
        ? html`<input
            type="text"
            class="input input-bordered input-primary input-sm"
            placeholder="Login..."
            .value="${state.addInput}"
            @input="${(e: Event) =>
              state.onInputChange(
                (e.target as HTMLInputElement).value,
              )}"
            @keydown="${(e: KeyboardEvent) => {
              if (e.key === "Enter") state.onAdd();
              if (e.key === "Escape") state.onToggleAdd();
            }}"
            ?disabled="${state.addLoading}"
          />`
        : ""}
      ${state.addOpen
        ? html`<button
            type="button"
            class="btn btn-sm btn-primary font-bold ${state.addLoading
              ? "loading"
              : ""}"
            @click="${state.onAdd}"
            ?disabled="${state.addLoading ||
            !state.addInput.trim()}"
          >
            ${state.addLoading ? "" : "Add"}
          </button>`
        : html`<button
            type="button"
            class="btn btn-circle btn-md btn-primary"
            data-tip="Add / delete friend"
            @click="${state.onToggleAdd}"
            aria-label="Add friend"
          >
            <span
              class="w-5 h-5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
              >${unsafeHTML(svgIcon(PLUS_SVG))}</span
            >
          </button>`}
      ${state.addOpen
        ? html`<button
            type="button"
            class="btn btn-circle btn-md btn-ghost"
            @click="${state.onToggleAdd}"
            aria-label="Close"
          >
            <span class="text-lg leading-none">✕</span>
          </button>`
        : ""}
    </div>
  </div>`;
}

export function renderFloatingActions(state: WidgetState) {
  if (state.notConnected || state.needsReconnect) return "";
  return html`<div class="friends-actions">
    ${state.deleteMode ? renderDeleteBar(state) : renderAddForm(state)}
  </div>`;
}
