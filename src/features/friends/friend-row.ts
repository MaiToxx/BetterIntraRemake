/**
 * One friend in the list: the avatar (custom or 42, click to swap between
 * them, with fallbacks when a picture fails to load), the level badge, the
 * name / grade / pool / location lines, the level bar, wallet and evaluation
 * points, and the selection checkbox in delete mode.
 */
import { html, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { FriendData } from "./friends-types.ts";
import { formatTimeAgo, svgIcon } from "./friends-format.ts";
import {
  sanitizeCssColor,
  sanitizeCssUrl,
} from "../profile/header/visuals-sanitize.ts";
import { CLUSTERS } from "../clusters/clusters.data.ts";
import WALLET_SVG from "../../assets/svg/wallet.svg?raw";
import EVAL_SVG from "../../assets/svg/eval.svg?raw";
import ARROW_SHARE_SVG from "../../assets/svg/arrow_share.svg?raw";

/** Glow of the top three rows when the list is ranked by level. */
const MEDALS = ["medal-glow-gold", "medal-glow-silver", "medal-glow-bronze"];

// Logins whose row shows the 42 picture instead of the custom avatar. Kept at
// module level so the choice survives re-renders and list refreshes.
const showingOriginalAvatars = new Map<string, boolean>();
const AVATAR_BG_KEYWORDS = new Set(["transparent"]);

export interface FriendRowOptions {
  /** Position in the level ranking, or -1 when the list is not ranked. */
  rank: number;
  showCustomAvatars: boolean;
  deleteMode: boolean;
  selected: boolean;
  onToggleSelect?: (login: string) => void;
  /** Called after a click swapped the avatar, so the widget re-renders. */
  onAvatarToggle: () => void;
}

function levelFraction(level: number): number {
  return level % 1;
}

function renderLevelBar(level: number) {
  const pct = Math.round(levelFraction(level) * 100);
  const whole = Math.floor(level);
  return html`
    <div class="flex items-center gap-1.5 w-full">
      <progress
        class="progress progress-primary flex-1"
        value="${pct}"
        max="100"
        style="height:1rem"
        aria-label="Level progress to level ${whole + 1}"
      ></progress>
      <span class="text-lg font-bold opacity-60 w-8 shrink-0"
        >${whole + 1}</span
      >
    </div>
  `;
}

function clusterUrl(location: string): string {
  const cluster = CLUSTERS.find((c) => location.startsWith(c.name));
  const hash = cluster ? `#cluster-${cluster.id}` : "";
  return `https://meta.intra.42.fr/clusters?seat=${location}${hash}`;
}

export function renderFriendRow(friend: FriendData, opts: FriendRowOptions) {
  const {
    rank,
    showCustomAvatars,
    deleteMode,
    selected,
    onToggleSelect,
    onAvatarToggle,
  } = opts;
  const medalClass = rank >= 0 && rank < MEDALS.length ? MEDALS[rank] : "";
  const hasCustom = !!(
    showCustomAvatars &&
    friend.customAvatar &&
    friend.customAvatar !== friend.avatar
  );
  const showingOriginal = showingOriginalAvatars.get(friend.login) ?? false;
  const currentSrc =
    hasCustom && !showingOriginal ? friend.customAvatar : friend.avatar;
  // Custom avatars are interpolated into an inline style: whatever the data
  // source (worker friends endpoint or intrapy + visuals), only a plain
  // http(s) URL and a plain colour may reach the CSS.
  const customBgUrl =
    hasCustom && !showingOriginal ? sanitizeCssUrl(currentSrc) : "";
  const showCustom = customBgUrl !== "";
  const avatarBg =
    sanitizeCssColor(friend.avatarBg, AVATAR_BG_KEYWORDS) || "transparent";
  const toggleTitle = hasCustom
    ? showingOriginal
      ? "Click to view custom avatar"
      : "Click to view original avatar"
    : "";

  const toggleCustom = hasCustom
    ? (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        const isOrig = showingOriginalAvatars.get(friend.login) ?? false;
        showingOriginalAvatars.set(friend.login, !isOrig);
        onAvatarToggle();
      }
    : undefined;

  return html`
    <!-- Avatar -->
    <div class="shrink-0 flex items-center" data-ft-avatar-col>
      <a
        href="https://profile-v3.intra.42.fr/users/${friend.login}"
        target="_blank"
        rel="noopener noreferrer"
        class="flex"
        @click="${(e: Event) => e.stopPropagation()}"
      >
        ${currentSrc
          ? html`<div class="avatar ${friend.isOnline ? "avatar-online" : ""}">
              ${showCustom
                ? html`<div
                    class="w-14 h-14 rounded-full cursor-pointer ${medalClass}"
                    style="background-image:url(${customBgUrl});background-size:${friend.avatarScale ??
                    100}%;background-position:${friend.avatarPosX ??
                    50}% ${friend.avatarPosY ??
                    50}%;background-color:${avatarBg};background-repeat:no-repeat;"
                    data-tip="${toggleTitle}"
                    @click="${toggleCustom}"
                  ></div>`
                : html`<div class="w-14 h-14 rounded-full ${medalClass}">
                    <img
                      src="${currentSrc}"
                      alt="${friend.login}"
                      loading="lazy"
                      data-tip="${toggleTitle}"
                      @click="${toggleCustom}"
                      @error="${(e: Event) => {
                        const img = e.target as HTMLImageElement;
                        if (img.dataset.fallback === "letter") return;
                        if (
                          hasCustom &&
                          !img.dataset.fallback &&
                          friend.avatar
                        ) {
                          img.dataset.fallback = "42";
                          img.src = friend.avatar;
                          return;
                        }
                        img.dataset.fallback = "letter";
                        const container = img.closest(".avatar");
                        if (!container) return;
                        const wrapper =
                          container.querySelector<HTMLElement>(".w-14");
                        if (!wrapper) return;
                        render(
                          html`<span class="text-base font-bold"
                            >${friend.login[0].toUpperCase()}</span
                          >`,
                          wrapper,
                        );
                        container.classList.add("avatar-placeholder");
                        container.classList.remove("avatar-online");
                        img.remove();
                      }}"
                    />
                  </div>`}
            </div>`
          : html`<div
              class="avatar avatar-placeholder ${friend.isOnline
                ? "avatar-online"
                : ""}"
            >
              <div class="w-14 h-14 rounded-full ${medalClass}">
                <span class="text-base font-bold"
                  >${friend.login[0].toUpperCase()}</span
                >
              </div>
            </div>`}
      </a>
    </div>

    <!-- Level badge -->
    <div
      class="badge badge-md badge-primary gap-1 px-2 ${medalClass}"
      data-ft-level-badge
      style="border-radius:0.75rem;height:auto;padding-block:0.15rem;font-weight:600;"
    >
      <span class="text-sm font-bold">${friend.level.toFixed(2)}</span>
    </div>

    <!-- Main info -->
    <a
      href="https://profile-v3.intra.42.fr/users/${friend.login}"
      target="_blank"
      rel="noopener noreferrer"
      class="no-underline text-base-content"
      data-ft-info
      @click="${(e: Event) => e.stopPropagation()}"
    >
      <!-- Login + display name -->
      <div
        class="flex items-center gap-1.5 flex-wrap min-w-0"
        data-ft-row="name"
      >
        <span class="font-bold text-lg text-primary">${friend.login}</span>
        ${friend.displayName && friend.displayName !== friend.login
          ? html`<span class="text-sm opacity-80 truncate"
              >${friend.displayName}</span
            >`
          : ""}
      </div>

      <!-- Grade + pool + location -->
      ${friend.grade ||
      friend.poolLabel ||
      (friend.isOnline && friend.lastSeen) ||
      (!friend.isOnline && friend.lastOnlineTimestamp)
        ? html` <div
            class="flex items-center gap-1 flex-wrap min-w-0"
            data-ft-row="meta"
          >
            ${[
              friend.grade
                ? html`<span
                    class="badge badge-md gap-1 px-2"
                    style="border:3px solid color-mix(in oklab, var(--color-accent) 40%, transparent);background-color:color-mix(in oklab, var(--color-accent) 10%, transparent);border-radius:0.75rem;height:auto;padding-block:0.15rem;"
                    >${friend.grade}</span
                  >`
                : "",
              friend.poolLabel
                ? html`<span
                    class="badge badge-md gap-1 px-2"
                    style="border:3px solid color-mix(in oklab, var(--color-accent) 40%, transparent);background-color:color-mix(in oklab, var(--color-accent) 10%, transparent);border-radius:0.75rem;height:auto;padding-block:0.15rem;"
                    >${friend.poolLabel}</span
                  >`
                : "",
              friend.isOnline && friend.lastSeen
                ? html`<a
                    href="${clusterUrl(friend.lastSeen)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="badge badge-success badge-md gap-1 px-2 hover:brightness-110 transition-all cursor-pointer no-underline"
                    style="border:3px solid color-mix(in oklab, var(--color-success) 55%, transparent);border-radius:0.75rem;height:auto;padding-block:0.15rem;font-weight:600;"
                    data-tip="View ${friend.lastSeen} on cluster map"
                  >
                    <span class="text-sm font-semibold"
                      >${friend.lastSeen}</span
                    >
                    <span
                      class="size-2.5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                      >${unsafeHTML(ARROW_SHARE_SVG)}</span
                    >
                  </a>`
                : !friend.isOnline && friend.lastOnlineTimestamp
                  ? html`<span
                      class="badge badge-md gap-1 px-2"
                      style="border:3px solid color-mix(in oklab, var(--color-accent) 40%, transparent);background-color:color-mix(in oklab, var(--color-accent) 10%, transparent);border-radius:0.75rem;height:auto;padding-block:0.15rem;"
                      >${formatTimeAgo(friend.lastOnlineTimestamp)}</span
                    >`
                  : "",
            ]
              .filter((p) => p)
              .map(
                (part, i) =>
                  html`${i > 0
                    ? html`<span class="opacity-50 text-sm shrink-0">·</span>`
                    : ""}${part}`,
              )}
          </div>`
        : ""}

      <!-- Level bar -->
      <div
        class="overflow-hidden w-full"
        style="border-radius:0.75rem;"
        data-ft-row="level"
      >
        ${renderLevelBar(friend.level)}
      </div>
    </a>

    <!-- Stats column -->
    <div
      class="list-col shrink-0 flex flex-col justify-center items-end gap-2"
      data-ft-stats-col
    >
      <div class="flex items-center gap-1.5" data-tip="Wallet">
        <span
          class="w-5 h-5 shrink-0 opacity-40 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
          >${unsafeHTML(svgIcon(WALLET_SVG))}</span
        >
        <span class="text-base font-bold opacity-80 w-14 text-right shrink-0"
          >${friend.wallet}</span
        >
      </div>
      <div class="flex items-center gap-1.5" data-tip="Evaluation points">
        <span
          class="w-5 h-5 shrink-0 opacity-40 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
          >${unsafeHTML(svgIcon(EVAL_SVG))}</span
        >
        <span class="text-base font-bold opacity-80 w-14 text-right shrink-0"
          >${friend.correctionPoints}</span
        >
      </div>
    </div>

    ${deleteMode
      ? html`<label
          class="list-col shrink-0 self-center flex items-center cursor-pointer"
          data-ft-delete-col
          @click="${(e: Event) => e.stopPropagation()}"
        >
          <input
            type="checkbox"
            class="checkbox checkbox-error checkbox-sm"
            .checked="${selected}"
            @change="${() => onToggleSelect?.(friend.login)}"
            aria-label="Select ${friend.login} for deletion"
          />
        </label>`
      : ""}
  `;
}
