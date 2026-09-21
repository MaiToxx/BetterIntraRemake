/**
 * What a click on the profile avatar does: on my own page it opens the
 * visuals editor, on someone else's it toggles between their custom avatar
 * and the Intra picture underneath.
 *
 * WHY a module of its own: it is the only part of the visuals that opens the
 * editor. Keeping it out of the apply step is what lets profile.modal.ts use
 * that step without importing its own opener back.
 *
 * The editor (profile.modal.ts and its tabs) is a chunk loaded on the first
 * click: only the owner of the page ever opens it.
 */
import { AVATAR_SELECTOR } from "../../../core/intra/selectors.ts";
import { pageState } from "./visuals-apply.ts";
import type { VisualUrls } from "./visuals-types.ts";

/**
 * The editor being loaded and built. createSettingsModal() only appends its
 * dialog after the chunk has loaded and a few settings reads: a second click
 * meanwhile would open a second editor, so it joins this one instead.
 */
let opening: Promise<void> | null = null;

function openEditor(onSave: (updatedVisuals: VisualUrls) => void): Promise<void> {
  if (opening) return opening;
  opening = import("./profile.modal.ts")
    .then((mod) => mod.createSettingsModal(onSave))
    .catch((err: unknown) => {
      // A tab left open across an extension update cannot load the chunk.
      console.warn("Better Intra: the profile editor could not be opened.", err);
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

/**
 * My own page: clicking the avatar opens the editor, and `onSave` receives
 * the visuals it saved. Attached once per avatar element.
 */
export function attachEditorListener(
  avatarEl: HTMLElement,
  onSave: (updatedVisuals: VisualUrls) => void,
): void {
  if (avatarEl.dataset.modalListener) return;
  avatarEl.dataset.modalListener = "true";
  avatarEl.style.cursor = "pointer";
  avatarEl.addEventListener("click", (e) => {
    e.stopPropagation();
    pageState.showingOriginalAvatar = false;
    void openEditor(onSave);
  });
}

/**
 * Someone else's page: clicking the avatar swaps their custom avatar for the
 * original Intra picture and back. `getVisuals` is read at click time, so the
 * listener always restores the visuals currently cached for the page.
 */
export function attachToggleListener(
  avatarEl: HTMLElement,
  getVisuals: () => VisualUrls | null,
): void {
  if (avatarEl.dataset.toggleListener) return;
  avatarEl.dataset.toggleListener = "true";
  avatarEl.style.cursor = "pointer";
  avatarEl.title = "Click to view original avatar";
  avatarEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const currentAvatar = document.querySelector(
      AVATAR_SELECTOR,
    ) as HTMLElement;
    if (!currentAvatar) return;
    const visualCache = getVisuals();
    if (pageState.showingOriginalAvatar) {
      pageState.showingOriginalAvatar = false;
      if (visualCache?.avatar) {
        currentAvatar.style.setProperty(
          "background-image",
          `url("${visualCache.avatar}")`,
          "important",
        );
        currentAvatar.style.setProperty(
          "background-color",
          visualCache.avatarBg || "transparent",
          "important",
        );
        currentAvatar.style.setProperty(
          "background-size",
          `${visualCache.avatarScale ?? 100}%`,
          "important",
        );
        currentAvatar.style.setProperty(
          "background-position",
          `${visualCache.avatarPosX ?? 50}% ${visualCache.avatarPosY ?? 50}%`,
          "important",
        );
        currentAvatar.classList.remove("ft-deco-solid");
        const d = visualCache.decoration;
        if (d && d !== "none") currentAvatar.classList.add(`ft-deco-${d}`);
      }
    } else {
      pageState.showingOriginalAvatar = true;
      currentAvatar.classList.remove("ft-deco-solid");
      if (pageState.originalAvatarUrl) {
        currentAvatar.style.setProperty(
          "background-image",
          `url("${pageState.originalAvatarUrl}")`,
          "important",
        );
      }
      currentAvatar.style.setProperty("background-size", "cover", "important");
      currentAvatar.style.setProperty(
        "background-position",
        "center",
        "important",
      );
      currentAvatar.style.setProperty(
        "background-color",
        "transparent",
        "important",
      );
    }
  });
}
