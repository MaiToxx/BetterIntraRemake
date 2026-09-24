/**
 * The scrolling body of the friends panel: the message that fits the current
 * state (not connected, session expired, loading, loading failed, no friends,
 * nobody online) or the list of friend rows itself.
 */
import { html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { FriendData } from "./friends-types.ts";
import type { WidgetState } from "./friends-widget-state.ts";
import { renderFriendRow } from "./friend-row.ts";
import FRIENDS_SVG from "../../assets/svg/friends.svg?raw";
import FORTY_TWO_SVG from "../../assets/svg/42_Logo.svg?raw";
import GLOBE_SVG from "../../assets/svg/globe-lucide.svg?raw";

function renderEmpty() {
  return html`
    <div class="flex flex-col items-center gap-2 py-16 opacity-40">
      <span class="w-16 h-16 [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
        >${unsafeHTML(FRIENDS_SVG)}</span
      >
      <p class="text-sm font-bold">No friends yet</p>
      <p class="text-xs text-center">
        Press + to add a login, or use Add friend on their profile
      </p>
    </div>
  `;
}

/**
 * The list could not be loaded at all. It used to fall through to "No friends
 * yet", which told a student with 20 saved logins that their list was gone.
 */
function renderLoadError(state: WidgetState) {
  return html`<div
    class="flex flex-col items-center gap-3 py-12 px-6 text-center"
    role="alert"
  >
    <span class="text-lg font-bold opacity-60">Could not load your friends</span>
    <p class="text-sm opacity-50">
      Your Intra session may have expired, or the network is down. Your list
      is still saved; reloading the page usually fixes it.
    </p>
    <button
      type="button"
      class="btn btn-primary btn-sm font-bold mt-2"
      @click="${state.onRefresh}"
    >
      Retry
    </button>
  </div>`;
}

/** Part of the list could not be refreshed: say so above what is shown. */
function renderRefreshWarning(state: WidgetState) {
  return html`<div
    class="flex items-center gap-2 px-5 py-2 text-sm text-base-content bg-warning/15 border-b border-warning/40"
    role="alert"
  >
    <span class="flex-1 min-w-0"
      >Could not refresh everything: some friends may be missing or out of
      date.</span
    >
    <button
      type="button"
      class="btn btn-xs btn-ghost shrink-0"
      @click="${state.onRefresh}"
    >
      Retry
    </button>
  </div>`;
}

/**
 * Content of `.friends-list`. `sorted` is what survives the online filter,
 * already in display order.
 */
/**
 * Saved logins the server does not know, each with a Remove button: without
 * a row they could not be deleted from the widget at all.
 */
function renderMissing(state: WidgetState) {
  if (state.missingLogins.length === 0) return "";
  return html`<div
    class="flex flex-wrap items-center gap-2 px-5 py-2 text-sm bg-base-200/60 border-b border-base-300"
  >
    <span class="opacity-70">Not found on the Intra:</span>
    ${state.missingLogins.map(
      (login) => html`<span class="badge badge-outline gap-1 pr-0">
        ${login}
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-circle min-h-0 h-5 w-5"
          aria-label="Remove ${login} from my friends"
          data-tip="Remove"
          @click="${() => state.onRemoveMissing(login)}"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </span>`,
    )}
  </div>`;
}

export function renderFriendsList(state: WidgetState, sorted: FriendData[]) {
  if (state.notConnected) {
    return html`<div
      class="flex flex-col items-center gap-4 py-12 px-6 text-center"
    >
      <span
        class="w-16 h-16 opacity-40 mb-2 [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
        >${unsafeHTML(FRIENDS_SVG)}</span
      >
      <p class="opacity-50 max-w-88">
        See who's online, track levels, wallets, and correction
        points for your 42 friends at a glance.
      </p>
      <button
        type="button"
        class="btn bg-[#00babc] text-white border-none hover:bg-[#1fd2d4] flex items-center justify-center gap-3 mt-2"
        style="height:3rem; min-width:15rem; font-size:1rem;"
        @click="${state.onConnect}"
      >
        <span class="font-bold tracking-wide">Connect with</span>
        <span
          class="size-8 flex items-center justify-center [&_polygon]:fill-current"
        >
          ${unsafeHTML(FORTY_TWO_SVG)}
        </span>
      </button>
    </div>`;
  }
  if (state.needsReconnect) {
    return html`<div
      class="flex flex-col items-center gap-3 py-12 px-6 text-center"
    >
      <span class="text-lg font-bold opacity-60"
        >Session expired</span
      >
      <p class="text-sm opacity-50">Please reconnect.</p>
      <button
        type="button"
        class="btn btn-primary btn-sm font-bold mt-2"
        @click="${state.onConnect}"
      >
        Reconnect
      </button>
    </div>`;
  }
  if (state.loading && state.friends.length === 0) {
    return html`<div class="flex justify-center py-12">
      <span class="loading loading-spinner loading-md"></span>
    </div>`;
  }
  if (state.friends.length === 0) {
    return state.loadError
      ? renderLoadError(state)
      : html`${renderMissing(state)}${renderEmpty()}`;
  }
  const warning = state.loadError
    ? renderRefreshWarning(state)
    : renderMissing(state);
  if (sorted.length === 0) {
    return html`${warning}<div
      class="flex flex-col items-center gap-2 py-16 opacity-40"
    >
      <span
        class="w-16 h-16 [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
        >${unsafeHTML(GLOBE_SVG)}</span
      >
      <p class="text-sm font-bold">No friends online</p>
      <p class="text-xs">
        Turn off the online filter to see everyone
      </p>
    </div>`;
  }
  return html`${warning}<ul class="list text-base-content">
    ${sorted.map(
      (f, i) =>
        html`<li
          class="list-row group ${state.selected.includes(f.login)
            ? "bg-base-200/50"
            : ""}"
        >
          ${renderFriendRow(f, {
            rank: state.sortBy === "level" && state.sortDir === "desc" ? i : -1,
            showCustomAvatars: state.showCustomAvatars,
            deleteMode: state.deleteMode,
            selected: state.selected.includes(f.login),
            onToggleSelect: state.onToggleSelect,
            onAvatarToggle: state.onAvatarToggle,
          })}
        </li>`,
    )}
  </ul>`;
}
