/**
 * The scrolling body of the friends panel: the message that fits the current
 * state (not connected, session expired, loading, no friends, nobody online)
 * or the list of friend rows itself.
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
      <p class="text-xs">Add one using the input below</p>
    </div>
  `;
}

/**
 * Content of `.friends-list`. `sorted` is what survives the online filter,
 * already in display order.
 */
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
  if (state.friends.length === 0) return renderEmpty();
  if (sorted.length === 0) {
    return html`<div
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
  return html`<ul class="list text-base-content">
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

/**
 * Debug aid for the row grid: after each render, logs where the first row's
 * cells land (console.debug, so it stays out of the default console view).
 */
export function debugRowAlignment(shadow: ShadowRoot | null) {
  if (!shadow) return;
  const row = shadow.querySelector<HTMLElement>(".friends-list .list-row");
  if (!row) return;
  const rr = row.getBoundingClientRect();
  const meas = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      offsetLeft: Math.round(r.left - rr.left),
      width: Math.round(r.width),
      tag: el.tagName.toLowerCase(),
    };
  };
  const firstText = (el: Element | null) => {
    if (!el) return null;
    const t = el.querySelector("span, a, progress");
    return meas(t ?? el);
  };
  const name = row.querySelector('[data-ft-row="name"]');
  const meta = row.querySelector('[data-ft-row="meta"]');
  const level = row.querySelector('[data-ft-row="level"]');
  const progress = row.querySelector("progress");
  console.debug(
    "[friends] row alignment",
    {
      avatar: meas(row.querySelector("[data-ft-avatar-col]")),
      name: meas(name),
      nameText: firstText(name),
      meta: meas(meta),
      metaText: firstText(meta),
      level: meas(level),
      progress: meas(progress),
    },
    { rowCss: getComputedStyle(row).gridTemplateColumns },
  );
}
