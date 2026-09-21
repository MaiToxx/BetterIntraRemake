/**
 * What each tab of the visuals editor shows: avatar, banner, background and
 * badges. Pure rendering: every change goes back through `onFormUpdate`, and
 * the dialog in profile.modal.ts decides what to do with it.
 *
 * WHY a module of its own: these four panels are most of the editor's
 * markup; apart from the dialog's lifecycle (open, load, save, reset) they
 * read top to bottom as one screen each.
 */
import { html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { getTitleBadges } from "./badges.ts";
import { renderAvatarEditor } from "./avatar-editor.ts";
import {
  renderModeRadios,
  renderUrlField,
  type FormState,
  type FormUpdate,
  type ImageHistory,
  type ImageKey,
  type ProfileTab,
} from "./profile-modal-form.ts";
import GRIP_VERTICAL_SVG from "../../../assets/svg/grip-vertical.svg?raw";
import EYE_SVG from "../../../assets/svg/eye.svg?raw";
import EYE_SLASH_SVG from "../../../assets/svg/eye-slash.svg?raw";

/** Index of the badge being dragged in the badges tab, if any. */
let badgeDragIdx: number | null = null;

/** Every tab's panel, rendered from the current form state. */
export function renderTabPanels(
  state: FormState,
  onFormUpdate: FormUpdate,
  history: ImageHistory,
  onClearHistory: (key: ImageKey) => void,
): Record<ProfileTab, unknown> {
  return {
    avatar: renderAvatarPanel(state, onFormUpdate, history, onClearHistory),
    banner: renderBannerPanel(state, onFormUpdate, history, onClearHistory),
    background: renderBackgroundPanel(
      state,
      onFormUpdate,
      history,
      onClearHistory,
    ),
    badges: renderBadgesPanel(state, onFormUpdate),
  };
}

function renderAvatarPanel(
  state: FormState,
  onFormUpdate: FormUpdate,
  history: ImageHistory,
  onClearHistory: (key: ImageKey) => void,
) {
  const isTransparent = state.avatarBg === "transparent";

  return html`
    <div class="rounded-box border border-base-300 bg-base-200/50 p-3">
      <div class="flex gap-5 items-start">
        <div class="flex-1 min-w-0">
          ${renderUrlField(
            "Image URL",
            state.avatar,
            (val) => onFormUpdate({ avatar: val }),
            history.avatar,
            () => onClearHistory("avatar"),
          )}
          <div class="flex gap-2 items-center mt-2">
            <div class="join w-full">
              <input
                type="radio"
                name="PROFILE_AVATAR_BG_MODE"
                class="btn btn-sm join-item flex-1"
                aria-label="Transparent"
                value="transparent"
                ?checked="${isTransparent}"
                @change="${() => onFormUpdate({ avatarBg: "transparent" })}"
              />
              <input
                type="radio"
                name="PROFILE_AVATAR_BG_MODE"
                class="btn btn-sm join-item flex-1"
                aria-label="Color"
                value="custom"
                ?checked="${!isTransparent}"
                @change="${() => onFormUpdate({ avatarBg: "#00bcba" })}"
              />
            </div>
            <div
              id="ft-avatar-bg-color-wrap"
              class="${isTransparent ? "hidden" : ""}"
            >
              <input
                type="color"
                id="PROFILE_AVATAR_BG_COLOR"
                class="input input-bordered input-sm p-1 h-8 w-14"
                .value="${isTransparent ? "#00bcba" : state.avatarBg}"
                @input="${(e: Event) =>
                  onFormUpdate({
                    avatarBg: (e.target as HTMLInputElement).value,
                  })}"
              />
            </div>
          </div>
          <div class="pt-2">
            <span class="text-xs opacity-60">Border</span>
            <div class="join w-full mt-1">
              <input
                type="radio"
                name="PROFILE_DECORATION"
                class="btn btn-sm join-item flex-1"
                aria-label="None"
                value="none"
                ?checked="${state.decoration === "none"}"
                @change="${() => onFormUpdate({ decoration: "none" })}"
              />
              <input
                type="radio"
                name="PROFILE_DECORATION"
                class="btn btn-sm join-item flex-1"
                aria-label="Solid"
                value="solid"
                ?checked="${state.decoration === "solid"}"
                @change="${() => onFormUpdate({ decoration: "solid" })}"
              />
            </div>
          </div>
        </div>

        <div class="w-64 shrink-0 flex flex-col items-start">
          ${state.avatar
            ? renderAvatarEditor(
                {
                  url: state.avatar,
                  posX: state.avatarPosX,
                  posY: state.avatarPosY,
                  scale: state.avatarScale,
                  bgColor: state.avatarBg,
                  decoration: state.decoration,
                },
                (changes) => {
                  const updates: Partial<FormState> = {};
                  if (changes.scale !== undefined)
                    updates.avatarScale = changes.scale;
                  if (changes.posX !== undefined)
                    updates.avatarPosX = changes.posX;
                  if (changes.posY !== undefined)
                    updates.avatarPosY = changes.posY;
                  onFormUpdate(updates);
                },
              )
            : html`<div
                class="w-52 h-52 rounded-full bg-base-300 flex items-center justify-center"
              >
                <span class="text-xs opacity-50">No avatar URL set</span>
              </div>`}
        </div>
      </div>
    </div>
  `;
}

function renderBannerPanel(
  state: FormState,
  onFormUpdate: FormUpdate,
  history: ImageHistory,
  onClearHistory: (key: ImageKey) => void,
) {
  return html`
    <div class="rounded-box border border-base-300 bg-base-200/50 p-3">
      <div
        class="text-xs font-semibold uppercase tracking-wider opacity-50 mb-3"
      >
        Banner
      </div>
      ${state.bannerColor
        ? ""
        : html`${renderUrlField(
            "Image URL",
            state.banner,
            (val) => onFormUpdate({ banner: val }),
            history.banner,
            () => onClearHistory("banner"),
          )}
          ${renderModeRadios("PROFILE_BANNER_MODE", state.bannerMode, (val) =>
            onFormUpdate({ bannerMode: val }),
          )}`}
      ${state.bannerColor
        ? html`<div class="form-control w-full">
            <label class="label py-1">
              <span class="label-text opacity-80">Color</span>
            </label>
            <input
              type="color"
              class="input input-bordered w-full h-10 p-1"
              .value="${state.bannerColor}"
              @input="${(e: Event) =>
                onFormUpdate({
                  bannerColor: (e.target as HTMLInputElement).value,
                })}"
            />
          </div>`
        : ""}
      <div class="join w-full mt-2">
        <input
          type="radio"
          name="PROFILE_BANNER_TYPE"
          class="btn btn-sm join-item flex-1"
          aria-label="Image"
          value="image"
          ?checked="${!state.bannerColor}"
          @change="${() => onFormUpdate({ bannerColor: "", banner: "" })}"
        />
        <input
          type="radio"
          name="PROFILE_BANNER_TYPE"
          class="btn btn-sm join-item flex-1"
          aria-label="Color"
          value="color"
          ?checked="${state.bannerColor !== ""}"
          @change="${() =>
            onFormUpdate({ bannerColor: "#333333", banner: "" })}"
        />
      </div>
    </div>
  `;
}

function renderBackgroundPanel(
  state: FormState,
  onFormUpdate: FormUpdate,
  history: ImageHistory,
  onClearHistory: (key: ImageKey) => void,
) {
  return html`
    <div class="rounded-box border border-base-300 bg-base-200/50 p-3">
      <div
        class="text-xs font-semibold uppercase tracking-wider opacity-50 mb-3"
      >
        Background
      </div>
      ${state.backgroundColor
        ? ""
        : html`${renderUrlField(
            "Image URL",
            state.background,
            (val) => onFormUpdate({ background: val }),
            history.background,
            () => onClearHistory("background"),
          )}
          ${renderModeRadios(
            "PROFILE_BACKGROUND_MODE",
            state.backgroundMode,
            (val) => onFormUpdate({ backgroundMode: val }),
          )}`}
      ${state.backgroundColor
        ? html`<div class="form-control w-full">
            <label class="label py-1">
              <span class="label-text opacity-80">Color</span>
            </label>
            <input
              type="color"
              class="input input-bordered w-full h-10 p-1"
              .value="${state.backgroundColor}"
              @input="${(e: Event) =>
                onFormUpdate({
                  backgroundColor: (e.target as HTMLInputElement).value,
                })}"
            />
          </div>`
        : ""}
      <div class="join w-full mt-2">
        <input
          type="radio"
          name="PROFILE_BACKGROUND_TYPE"
          class="btn btn-sm join-item flex-1"
          aria-label="Image"
          value="image"
          ?checked="${!state.backgroundColor}"
          @change="${() =>
            onFormUpdate({ backgroundColor: "", background: "" })}"
        />
        <input
          type="radio"
          name="PROFILE_BACKGROUND_TYPE"
          class="btn btn-sm join-item flex-1"
          aria-label="Color"
          value="color"
          ?checked="${state.backgroundColor !== ""}"
          @change="${() =>
            onFormUpdate({ backgroundColor: "#333333", background: "" })}"
        />
      </div>
    </div>
  `;
}

function renderBadgesPanel(state: FormState, onFormUpdate: FormUpdate) {
  const liveBadges = getTitleBadges(document).map((b) => b.title);
  const normalizedOrder = state.badgeOrder.filter((n) => !n.startsWith("-"));
  const knownHidden = new Set(
    state.badgeOrder
      .filter((n) => n.startsWith("-"))
      .map((n) => n.substring(1).trim().toLowerCase()),
  );
  const mergedTitles = [
    ...normalizedOrder,
    ...liveBadges.filter((t) => !normalizedOrder.includes(t)),
  ];
  const badgeTitles = mergedTitles.filter(
    (t, i) => mergedTitles.indexOf(t) === i,
  );

  const setBadgeHidden = (title: string, hidden: boolean) => {
    const clean = state.badgeOrder
      .filter((n) => n.trim().toLowerCase() !== title.toLowerCase())
      .filter((n) => n !== `-${title}` && n.substring(1) !== title);
    const next = [...clean];
    if (hidden) next.push(`-${title}`);
    else next.push(title);
    const idx = badgeTitles.indexOf(title);
    if (idx === -1) next.push(title);
    onFormUpdate({ badgeOrder: next });
  };

  const moveBadge = (from: number, to: number) => {
    if (from === to) return;
    const list = [...badgeTitles];
    const [removed] = list.splice(from, 1);
    list.splice(to, 0, removed);
    const hidden = badgeTitles
      .filter((t) => knownHidden.has(t.toLowerCase()))
      .map((t) => `-${t}`);
    onFormUpdate({ badgeOrder: [...list, ...hidden] });
  };

  return html`
    <div class="flex flex-col gap-3">
      <div class="flex gap-3 flex-col sm:flex-row">
        <div
          class="rounded-box border border-base-300 bg-base-200/50 p-3 flex-1 flex flex-col justify-center"
        >
          <div
            class="text-xs font-semibold uppercase tracking-wider opacity-50 mb-3"
          >
            Background color
          </div>
          <div class="form-control">
            <div class="flex gap-2 items-center">
              <input
                type="color"
                class="input input-bordered w-full h-10 p-1"
                .value="${state.badgeBg || "#00babc"}"
                @input="${(e: Event) =>
                  onFormUpdate({
                    badgeBg: (e.target as HTMLInputElement).value,
                  })}"
              />
              <button
                type="button"
                class="btn btn-ghost btn-sm shrink-0"
                @click="${() => onFormUpdate({ badgeBg: "" })}"
              >
                Default
              </button>
            </div>
          </div>
        </div>

        <div
          class="rounded-box border border-base-300 bg-base-200/50 p-3 flex-1 flex flex-col justify-center"
        >
          <div class="form-control">
            <label
              class="flex items-center justify-between cursor-pointer gap-2"
            >
              <span class="label-text opacity-80"
                >Wrap onto multiple lines</span
              >
              <input
                type="checkbox"
                class="toggle toggle-sm shrink-0"
                .checked="${state.badgeWrap}"
                @change="${(e: Event) =>
                  onFormUpdate({
                    badgeWrap: (e.target as HTMLInputElement).checked,
                  })}"
              />
            </label>
          </div>
        </div>
      </div>

      <div class="rounded-box border border-base-300 bg-base-200/50 p-3">
        <div
          class="text-xs font-semibold uppercase tracking-wider opacity-50 mb-3"
        >
          Order & visibility
        </div>
        <div class="flex flex-wrap gap-3 items-center">
          <span class="text-xs opacity-50 w-full pb-1"
            >Drag to reorder · click the eye to hide</span
          >
          ${badgeTitles.map((title, idx) => {
            const isHidden = knownHidden.has(title.toLowerCase());
            return html`
              <div
                class="btn btn-sm border shadow-sm transition-all select-none gap-2 font-bold normal-case px-3 cursor-grab active:cursor-grabbing ${isHidden
                  ? "opacity-30 line-through saturate-50 scale-95"
                  : ""}"
                data-ft-badge-idx="${idx}"
                draggable="true"
                @dragstart="${(e: DragEvent) => {
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                  (e.currentTarget as HTMLElement).style.opacity = "0.3";
                  badgeDragIdx = idx;
                }}"
                @dragover="${(e: DragEvent) => e.preventDefault()}"
                @dragend="${(e: DragEvent) => {
                  (e.currentTarget as HTMLElement).style.opacity = "";
                  badgeDragIdx = null;
                }}"
                @drop="${(e: DragEvent) => {
                  e.preventDefault();
                  if (badgeDragIdx !== null) moveBadge(badgeDragIdx, idx);
                  badgeDragIdx = null;
                }}"
              >
                <span
                  class="size-3 shrink-0 opacity-40 pointer-events-none flex items-center justify-center"
                  >${unsafeHTML(GRIP_VERTICAL_SVG)}</span
                >
                <button
                  type="button"
                  class="p-1 -ml-1 rounded hover:bg-black/10 transition-colors cursor-pointer flex items-center justify-center text-white"
                  @click="${() => setBadgeHidden(title, !isHidden)}"
                  data-tip="${isHidden ? "Show badge" : "Hide badge"}"
                >
                  ${isHidden
                    ? html`<span
                        class="size-4 opacity-80 flex items-center justify-center"
                        >${unsafeHTML(EYE_SLASH_SVG)}</span
                      >`
                    : html`<span
                        class="size-4 opacity-60 flex items-center justify-center"
                        >${unsafeHTML(EYE_SVG)}</span
                      >`}
                </button>
                <span class="pointer-events-none">${title}</span>
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}
