/**
 * The widget's whole shadow-root template: the floating button with its
 * online-count badge, and the dropdown panel it opens, whose header carries
 * the friend count, the online filter, the sort buttons and refresh. The list
 * body, the floating actions and the CSS come from their own modules.
 */
import { html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { ifDefined } from "lit-html/directives/if-defined.js";
import { sharedStylesLink } from "../../core/styles/shared-styles.ts";
import { THEMES } from "../../core/theme/theme-manager.ts";
import type { WidgetState } from "./friends-widget-state.ts";
import { formatTimeAgo, svgIcon } from "./friends-format.ts";
import { renderSortControl, visibleFriends } from "./friends-sort.ts";
import { renderFriendsList } from "./friends-list.ts";
import { renderFloatingActions } from "./friends-actions.ts";
import { FRIENDS_WIDGET_STYLES } from "./friends-widget-styles.ts";
import { t } from "../../core/i18n/i18n.ts";
import FRIENDS_SVG from "../../assets/svg/friends.svg?raw";
import WARNING_SVG from "../../assets/svg/triangle-exclamation.svg?raw";
import GLOBE_SVG from "../../assets/svg/globe-lucide.svg?raw";

/** Online filter, sort buttons and refresh, once there is a list to act on. */
function renderHeaderControls(state: WidgetState, onlineCount: number) {
  if (state.friends.length === 0) return "";
  const preset = THEMES[state.theme] ?? THEMES["dark"];
  const primaryColor = `hsl(${preset.primary})`;
  const primaryContent = `hsl(${preset.primaryForeground})`;

  return html`<div class="flex items-center gap-2 min-w-0 ml-auto">
    <button
      type="button"
      class="btn btn-sm px-2 shrink-0 gap-1.5 ${state.onlineOnly
        ? ""
        : "btn-success"}"
      style="height:1.875rem;${state.onlineOnly
        ? `background-color:${primaryColor};border-color:${primaryColor};color:${primaryContent};`
        : ""}"
      data-tip="${t(
        state.onlineOnly
          ? "Showing online users only (click to show all)"
          : "Show only online users",
      )}"
      @click="${state.onToggleOnline}"
      aria-pressed="${state.onlineOnly}"
    >
      ${onlineCount > 0
        ? html`<span class="text-sm font-bold"
            >${onlineCount}</span
          >`
        : ""}
      <span
        class="w-4 h-4 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
        >${unsafeHTML(svgIcon(GLOBE_SVG))}</span
      >
    </button>
    <div class="mx-0.5 h-5 w-px bg-base-content/20 shrink-0"></div>
    <div class="overflow-x-auto no-scrollbar shrink-0">
      ${renderSortControl(
        state.sortBy,
        state.sortDir,
        primaryColor,
        primaryContent,
        state.onSortChange,
      )}
    </div>
    <div class="mx-0.5 h-5 w-px bg-base-content/20 shrink-0"></div>
    <button
      type="button"
      class="btn btn-sm btn-square shrink-0 hover:opacity-100 ${state.loading
        ? "loading"
        : ""} ${state.lastFetch &&
      Date.now() - state.lastFetch < 60000
        ? "btn-outline btn-success"
        : "btn-ghost"}"
      style="height:1.875rem;"
      data-tip="${state.loadError
        ? t("Refresh failed (click to retry)")
        : state.lastFetch
          ? t("Updated {ago}", { ago: formatTimeAgo(state.lastFetch) })
          : t("Not yet updated")}"
      aria-label="${t("Refresh friends")}"
      @click="${state.onRefresh}"
    >
      <div
        class="swap ${state.loading ? "swap-active" : ""}"
        aria-hidden="true"
      >
        <span
          class="swap-on loading loading-spinner loading-xs"
        ></span>
        <span class="swap-off text-lg">↻</span>
      </div>
    </button>
  </div>`;
}

export function renderWidget(state: WidgetState) {
  const onlineCount = state.friends.filter((f) => f.isOnline).length;
  const sorted = visibleFriends(
    state.friends,
    state.onlineOnly,
    state.sortBy,
    state.sortDir,
  );

  return html`
    ${sharedStylesLink()}
    ${FRIENDS_WIDGET_STYLES}

    <div data-theme="${state.theme}">
      <!-- FAB -->
      <div class="friends-fab">
        <div class="indicator">
          ${onlineCount > 0 && !state.needsReconnect
            ? html`<span
                class="indicator-item badge badge-success badge-sm font-bold min-w-6 px-1.5"
                >${onlineCount}</span
              >`
            : ""}
          <button
            type="button"
            class="btn btn-circle btn-lg ${state.needsReconnect
              ? "btn-error"
              : "btn-primary"} shadow-xl"
            @click="${state.needsReconnect ? state.onConnect : state.onToggle}"
            data-tip="${state.needsReconnect
              ? t("Token expired — reconnect")
              : t(state.open ? "Close" : "Friends")}"
            aria-label="${state.needsReconnect
              ? t("Friends: session expired, reconnect")
              : t(state.open ? "Close friends" : "Friends")}"
            aria-expanded="${ifDefined(
              state.needsReconnect ? undefined : String(state.open),
            )}"
            aria-controls="${ifDefined(
              state.needsReconnect ? undefined : "friends-dropdown",
            )}"
          >
            ${state.needsReconnect
              ? html`<div class="swap" aria-hidden="true">
                  <span
                    class="swap-on flex items-center justify-center w-8 h-8 [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
                    >${unsafeHTML(WARNING_SVG)}</span
                  >
                  <span
                    class="swap-off flex items-center justify-center w-8 h-8 [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
                    >${unsafeHTML(WARNING_SVG)}</span
                  >
                </div>`
              : html`
                  <div
                    class="swap ${state.open ? "swap-active" : ""}"
                    aria-hidden="true"
                  >
                    <span class="swap-on text-3xl">✕</span>
                    <span
                      class="swap-off flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
                      >${unsafeHTML(FRIENDS_SVG)}</span
                    >
                  </div>
                `}
          </button>
        </div>
      </div>

      <!-- Dropdown. Closed, it is only faded out (so the fade can play):
           inert takes its controls out of the Tab order and away from
           screen readers, which otherwise walked through every hidden row. -->
      <div
        id="friends-dropdown"
        class="friends-dropdown card card-border bg-base-100 shadow-xl ${state.open
          ? ""
          : "closed"}"
        ?inert="${!state.open}"
      >
        <!-- Header. flex-wrap: on a phone the controls need more than the
             panel's width, and every one of them is shrink-0 (the sort group
             hides its scrollbar, so a squeezed group loses buttons without a
             sign): they drop to a second line instead of pushing refresh out
             of the panel. The 480 px desktop panel keeps them on one line. -->
        <div
          class="friends-header flex flex-wrap items-center gap-2 px-5 pt-3 pb-3 border-b border-base-300 bg-base-200/50 shrink-0"
        >
          <div class="flex items-center gap-2.5 min-w-0 flex-none flex-wrap">
            <span class="font-bold text-lg text-base-content"
              >${t("Friends")}</span
            >
            ${state.friends.length > 0
              ? html`<span
                  class="badge badge-primary badge-md font-bold"
                  style="border:3px solid color-mix(in oklab, var(--color-primary) 55%, transparent);border-radius:0.75rem;height:auto;padding-block:0.15rem;font-weight:600;"
                  >${state.friends.length}</span
                >`
              : ""}
          </div>
          ${renderHeaderControls(state, onlineCount)}
        </div>

        <!-- Friend list + floating actions -->
        <div class="friends-list-wrap">
          <div class="friends-list">
            ${renderFriendsList(state, sorted)}
          </div>

          <!-- Floating actions (add / delete, only when connected) -->
          ${renderFloatingActions(state)}
        </div>
      </div>
    </div>
  `;
}
