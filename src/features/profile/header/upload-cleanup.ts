/**
 * Deleting uploaded images that no field uses any more.
 *
 * WHY: an upload is public at /img/<login hash>/<slot>, and the hash is the
 * SHA-256 of a public login. Clearing the field, pasting a link over it or
 * Reset used to leave the picture served there for good.
 */
import { fetchMySettings } from "../../account/account.ts";
import {
  deleteProfileImage,
  IMAGE_SLOTS,
  ownUploadHash,
  uploadedSlotOf,
  type ImageSlot,
} from "./image-upload.ts";

const CLOUD_URL_KEYS = [
  "PROFILE_IMAGE_URL",
  "PROFILE_BANNER_URL",
  "PROFILE_BACKGROUND_URL",
] as const;

const HISTORY_KEYS = [
  "PROFILE_IMAGE_HISTORY",
  "PROFILE_BANNER_HISTORY",
  "PROFILE_BACKGROUND_HISTORY",
] as const;

function slotsUsedBy(urls: readonly unknown[], hash: string): Set<ImageSlot> {
  const used = new Set<ImageSlot>();
  for (const url of urls) {
    const slot = uploadedSlotOf(url, hash);
    if (slot) used.add(slot);
  }
  return used;
}

/**
 * Deletes the uploads that `previousUrls` used, or that this editor sent
 * (`uploaded`), when none of `keptUrls` uses them any more. Checked by slot
 * across all three fields, not field by field: the avatar's upload pasted as
 * the background is still in use.
 *
 * Before any delete the cloud copy is read back, and a slot it still names is
 * kept: that is what visitors are shown, and it still names the old URL when
 * the push that should have replaced it failed (syncMyVisuals only logs).
 * A student who never uploaded costs no request at all. Returns the slots
 * deleted.
 */
export async function deleteUnusedUploads(
  previousUrls: readonly unknown[],
  uploaded: Iterable<ImageSlot>,
  keptUrls: readonly unknown[],
): Promise<ImageSlot[]> {
  try {
    const hash = await ownUploadHash();
    if (!hash) return [];
    const candidates = slotsUsedBy(previousUrls, hash);
    for (const slot of uploaded) candidates.add(slot);
    for (const slot of slotsUsedBy(keptUrls, hash)) candidates.delete(slot);
    if (candidates.size === 0) return [];

    const cloud = (await fetchMySettings()) as Record<string, unknown> | null;
    if (!cloud) return [];
    const cloudUrls = CLOUD_URL_KEYS.map((key) => cloud[key]);
    for (const slot of slotsUsedBy(cloudUrls, hash)) candidates.delete(slot);

    const deleted: ImageSlot[] = [];
    for (const slot of IMAGE_SLOTS) {
      if (candidates.has(slot) && (await deleteProfileImage(slot))) deleted.push(slot);
    }
    if (deleted.length > 0) await forgetInHistory(deleted, hash);
    return deleted;
  } catch (e) {
    console.warn("[images] cleanup failed:", e);
    return [];
  }
}

/** A deleted upload's history thumbnail would only show a broken image. */
async function forgetInHistory(slots: ImageSlot[], hash: string): Promise<void> {
  const stored = (await chrome.storage.local.get([...HISTORY_KEYS])) as Record<string, unknown>;
  const updates: Record<string, unknown[]> = {};
  for (const key of HISTORY_KEYS) {
    const list = stored[key];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((url) => {
      const slot = uploadedSlotOf(url, hash);
      return !slot || !slots.includes(slot);
    });
    if (kept.length !== list.length) updates[key] = kept;
  }
  if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
}
