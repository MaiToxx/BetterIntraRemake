/**
 * Ordering and filtering of the friends list, and the sort buttons of the
 * panel header. The controller (friends.ui.ts) persists the chosen mode and
 * direction under FRIENDS_SORT_MODE / FRIENDS_SORT_DIR.
 */
import { html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { FriendData } from "./friends-types.ts";
import { svgIcon } from "./friends-format.ts";
import { msg, t } from "../../core/i18n/i18n.ts";
import USER_SVG from "../../assets/svg/user-lucide.svg?raw";
import STAR_SVG from "../../assets/svg/star-lucide.svg?raw";
import WALLET_SVG from "../../assets/svg/wallet.svg?raw";
import EVAL_SVG from "../../assets/svg/eval.svg?raw";

export type SortMode = "name" | "level" | "wallet" | "correction";
export type SortDir = "asc" | "desc";

export const SORT_MODES: SortMode[] = ["name", "level", "wallet", "correction"];

/** Direction a mode starts in when its button is pressed for the first time. */
const SORT_DEFAULTS: Record<SortMode, SortDir> = {
  name: "asc",
  level: "desc",
  wallet: "desc",
  correction: "desc",
};

const SORT_ICONS: Record<SortMode, string> = {
  name: USER_SVG,
  level: STAR_SVG,
  wallet: WALLET_SVG,
  correction: EVAL_SVG,
};

/** Marked with msg(), translated with t() where shown. Wallet stays Wallet. */
const SORT_LABELS: Record<SortMode, string> = {
  name: msg("Name"),
  level: msg("Level"),
  wallet: "Wallet",
  correction: msg("Evaluation"),
};

/** The tooltip of a sort button: its label, and the direction when active. */
function sortTip(mode: SortMode, active: boolean, dir: SortDir): string {
  const label = t(SORT_LABELS[mode]);
  if (!active) return label;
  return dir === "asc"
    ? t("{label} (ascending)", { label })
    : t("{label} (descending)", { label });
}

export function sortFriends(
  friends: FriendData[],
  mode: SortMode,
  dir: SortDir = "desc",
): FriendData[] {
  const sorted = [...friends];
  const dirMul = dir === "desc" ? 1 : -1;
  switch (mode) {
    case "name":
      sorted.sort(
        (a, b) => a.login.localeCompare(b.login) * (dir === "desc" ? -1 : 1),
      );
      break;
    case "level":
      sorted.sort((a, b) => (b.level - a.level) * dirMul);
      break;
    case "wallet":
      sorted.sort((a, b) => (b.wallet - a.wallet) * dirMul);
      break;
    case "correction":
      sorted.sort((a, b) => (b.correctionPoints - a.correctionPoints) * dirMul);
      break;
  }
  return sorted;
}

/** What the list shows: online friends only when the filter is on, sorted. */
export function visibleFriends(
  friends: FriendData[],
  onlineOnly: boolean,
  mode: SortMode,
  dir: SortDir,
): FriendData[] {
  const visible = onlineOnly ? friends.filter((f) => f.isOnline) : friends;
  return sortFriends(visible, mode, dir);
}

/** The header's button group: pressing the active mode flips its direction. */
export function renderSortControl(
  current: SortMode,
  dir: SortDir,
  primaryColor: string,
  primaryContent: string,
  onChange: (mode: SortMode, dir: SortDir) => void,
) {
  return html`
    <div class="join join-horizontal" data-tip="${t("Sort by")}">
      ${SORT_MODES.map(
        (m) => html`
          <button
            type="button"
            class="btn btn-sm join-item px-0 w-8"
            style="height:1.875rem;${current === m
              ? `background-color:${primaryColor};border-color:${primaryColor};color:${primaryContent};`
              : ""}"
            data-tip="${sortTip(m, current === m, dir)}"
            @click="${() =>
              onChange(
                m,
                current === m
                  ? dir === "asc"
                    ? "desc"
                    : "asc"
                  : SORT_DEFAULTS[m],
              )}"
          >
            <span
              class="w-4 h-4 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
              >${unsafeHTML(svgIcon(SORT_ICONS[m]))}</span
            >
          </button>
        `,
      )}
    </div>
  `;
}
