/**
 * Deleting uploaded images that no field uses any more.
 *
 * WHY: an upload is public at /img/<login hash>/<slot>, and the hash is the
 * SHA-256 of a public login. Clearing the field, pasting a link over it or
 * Reset used to leave the picture served there for good.
 */
import { getConfigMany } from "../../../core/config.ts";
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

/**
 * The slots a cleanup could not delete yet, with the login hash they belong
 * to and the time of the last try. A plain storage key on purpose, outside
 * the settings: it never goes into the cloud copy nor into a backup file.
 *
 * WHY: a slot the cloud copy still names is kept, and it still names the old
 * URL when the push that should have replaced it failed (a 429, the network).
 * The next push then wrote the new URL and nothing took the old picture down:
 * it stayed public at a URL anyone can compute from the login. The slot now
 * waits here, and every later cleanup tries it again: the editor's next Save,
 * Reset or Cancel, and the next visit of my own profile.
 */
export const PENDING_CLEANUP_KEY = "PENDING_IMAGE_CLEANUP";

/**
 * A profile visit retries at most this often: while the pushes keep failing
 * the cloud copy keeps naming the slot, and every page would read the whole
 * record back for nothing.
 */
const VISIT_RETRY_MS = 10 * 60 * 1000;

/**
 * Per slot, what the cloud copy named at the last read: the fields naming
 * the slot with the `v` of each ("PROFILE_IMAGE_URL=17..."), "" for none.
 * Absent while the copy was never read for that removal.
 */
type Marks = Partial<Record<ImageSlot, string>>;

interface PendingCleanup {
  hash: string;
  slots: ImageSlot[];
  /**
   * WHY: a pending slot is a standing order to delete once the cloud copy
   * stops naming it, and that order can outlive the removal by weeks. When
   * the copy names the slot differently since (another browser uploaded into
   * it, or picked it back from the history), the student uses it again and
   * the old bytes are already replaced: the order is dropped. Without this,
   * a stale push from this browser taking it out of the copy again deleted
   * the picture that other browser shows.
   */
  seen: Marks;
  triedAt: number;
}

async function readPending(): Promise<PendingCleanup | null> {
  const raw = (await chrome.storage.local.get(PENDING_CLEANUP_KEY))[
    PENDING_CLEANUP_KEY
  ] as Partial<PendingCleanup> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const { hash, slots, seen, triedAt } = raw;
  if (typeof hash !== "string" || !Array.isArray(slots)) return null;
  const list = IMAGE_SLOTS.filter((slot) => slots.includes(slot));
  const marks: Marks = {};
  if (seen && typeof seen === "object") {
    for (const slot of list) {
      const mark = (seen as Record<string, unknown>)[slot];
      if (typeof mark === "string") marks[slot] = mark;
    }
  }
  return {
    hash,
    slots: list,
    seen: marks,
    triedAt: typeof triedAt === "number" ? triedAt : 0,
  };
}

/**
 * Stores what a cleanup left of the slots it `considered`: `left` replaces
 * what the list said about them, and a slot another tab added meanwhile
 * stays. A slot keeps the mark this cleanup read (`seen`), else the one the
 * list had, unless this cleanup removed it anew (`fresh`): an older read says
 * nothing about the new removal. Another login's list is replaced only when
 * this one has slots to keep (one login per browser at a time). Nothing is
 * written when nothing changes: every write wakes each storage listener, the
 * background included.
 */
async function savePending(
  hash: string,
  considered: ReadonlySet<ImageSlot>,
  fresh: ReadonlySet<ImageSlot>,
  left: ReadonlySet<ImageSlot>,
  seen: Marks,
): Promise<void> {
  const stored = await readPending();
  const mine = stored?.hash === hash ? stored : null;
  const before = mine?.slots ?? [];
  const slots = IMAGE_SLOTS.filter(
    (slot) => left.has(slot) || (before.includes(slot) && !considered.has(slot)),
  );
  if (slots.length === 0) {
    if (mine) await chrome.storage.local.remove(PENDING_CLEANUP_KEY);
    return;
  }
  const same = slots.length === before.length && slots.every((slot, i) => slot === before[i]);
  // A slot left behind means a try that failed: its time holds the next visit off.
  if (same && left.size === 0) return;
  const marks: Marks = {};
  for (const slot of slots) {
    const mark = slot in seen ? seen[slot] : fresh.has(slot) ? undefined : mine?.seen[slot];
    if (mark !== undefined) marks[slot] = mark;
  }
  const record: PendingCleanup = {
    hash,
    slots,
    seen: marks,
    triedAt: left.size > 0 ? Date.now() : (mine?.triedAt ?? 0),
  };
  await chrome.storage.local.set({ [PENDING_CLEANUP_KEY]: record });
}

function slotsUsedBy(urls: readonly unknown[], hash: string): Set<ImageSlot> {
  const used = new Set<ImageSlot>();
  for (const url of urls) {
    const slot = uploadedSlotOf(url, hash);
    if (slot) used.add(slot);
  }
  return used;
}

/** The Marks of every slot in `settings` ("" for a slot no field names). */
function marksOf(settings: Record<string, unknown>, hash: string): Record<ImageSlot, string> {
  const parts: Record<ImageSlot, string[]> = { avatar: [], banner: [], background: [] };
  for (const key of CLOUD_URL_KEYS) {
    const url = settings[key];
    const slot = uploadedSlotOf(url, hash);
    // uploadedSlotOf parsed it already: a string and a valid URL
    if (slot) parts[slot].push(`${key}=${new URL(url as string).searchParams.get("v") ?? ""}`);
  }
  return {
    avatar: parts.avatar.join(","),
    banner: parts.banner.join(","),
    background: parts.background.join(","),
  };
}

/**
 * One cleanup at a time in a tab: a profile visit's retry and the editor's
 * Save could otherwise read the pending list together and one of them write
 * back a list without the other's slots.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Deletes the uploads that `previousUrls` used, that this editor sent
 * (`uploaded`) or that an earlier cleanup left pending, when none of
 * `keptUrls` uses them any more. Checked by slot across all three fields,
 * not field by field: the avatar's upload pasted as the background is still
 * in use. A pending slot a field uses again leaves the list.
 *
 * Before any delete the cloud copy is read back, and a slot it still names is
 * kept: that is what visitors are shown, and it still names the old URL when
 * the push that should have replaced it failed (syncMyVisuals only logs).
 * Such a slot, and one whose delete failed, stays pending for the next
 * cleanup (PENDING_CLEANUP_KEY); a pending slot the copy names differently
 * since leaves the list (see PendingCleanup.seen). A student who never
 * uploaded costs no request at all. Returns the slots deleted.
 */
export function deleteUnusedUploads(
  previousUrls: readonly unknown[],
  uploaded: Iterable<ImageSlot>,
  keptUrls: readonly unknown[],
): Promise<ImageSlot[]> {
  // Copied now: the run may wait for another cleanup, and the editor empties
  // its uploads (and rewrites its saved URLs) meanwhile.
  const previous = [...previousUrls];
  const sent = [...uploaded];
  const kept = [...keptUrls];
  const run = queue.then(() => cleanUp(previous, sent, kept));
  queue = run.catch(() => undefined);
  return run;
}

async function cleanUp(
  previousUrls: readonly unknown[],
  uploaded: readonly ImageSlot[],
  keptUrls: readonly unknown[],
): Promise<ImageSlot[]> {
  const deleted: ImageSlot[] = [];
  const considered = new Set<ImageSlot>();
  const left = new Set<ImageSlot>();
  const seen: Marks = {};
  let fresh = new Set<ImageSlot>();
  let hash: string | null = null;
  // Set once `left` holds the verdict: a failure before it (the pending list
  // unreadable) must not rewrite the list from a partial view.
  let decided = false;
  try {
    hash = await ownUploadHash();
    if (!hash) return [];
    fresh = slotsUsedBy(previousUrls, hash);
    for (const slot of uploaded) fresh.add(slot);
    const stored = await readPending();
    const pending = stored?.hash === hash ? stored : null;
    for (const slot of fresh) considered.add(slot);
    for (const slot of pending?.slots ?? []) considered.add(slot);
    if (considered.size === 0) return [];

    const inUse = slotsUsedBy(keptUrls, hash);
    for (const slot of considered) if (!inUse.has(slot)) left.add(slot);
    decided = true;
    if (left.size === 0) return [];

    const cloud = (await fetchMySettings()) as Record<string, unknown> | null;
    if (!cloud) return [];
    const named = marksOf(cloud, hash);

    const unnamed: ImageSlot[] = [];
    for (const slot of IMAGE_SLOTS) {
      if (!left.has(slot)) continue;
      const mark = named[slot];
      if (!mark) {
        unnamed.push(slot);
        continue;
      }
      const last = pending?.seen[slot];
      if (!fresh.has(slot) && last !== undefined && last !== mark) {
        left.delete(slot);
      } else {
        seen[slot] = mark;
      }
    }
    if (unnamed.length === 0) return [];

    // Read again right before the deletes: another tab may have saved a field
    // using the slot (a new upload into it) while this cleanup waited for its
    // turn or for the cloud copy. What this browser shows is never deleted.
    const local = (await chrome.storage.local.get([...CLOUD_URL_KEYS])) as Record<string, unknown>;
    const usedHere = slotsUsedBy(CLOUD_URL_KEYS.map((key) => local[key]), hash);
    for (const slot of unnamed) {
      if (usedHere.has(slot)) {
        left.delete(slot);
      } else if (await deleteProfileImage(slot)) {
        deleted.push(slot);
        left.delete(slot);
      } else {
        seen[slot] = "";
      }
    }
    if (deleted.length > 0) await forgetInHistory(deleted, hash);
    return deleted;
  } catch (e) {
    console.warn("[images] cleanup failed:", e);
    return deleted;
  } finally {
    if (hash && decided) {
      try {
        await savePending(hash, considered, fresh, left, seen);
      } catch (e) {
        console.warn("[images] could not keep the cleanup for later:", e);
      }
    }
  }
}

let visitRetried = false;

/**
 * On a visit of my own profile, once per page: tries the pending slots again
 * (a push since then may have replaced the URL the cloud copy named), keeping
 * any that a field of this browser uses. One storage read when nothing is
 * pending, and at most one try every VISIT_RETRY_MS.
 */
export async function retryPendingUploadCleanup(): Promise<void> {
  if (visitRetried) return;
  visitRetried = true;
  try {
    const pending = await readPending();
    if (!pending || pending.slots.length === 0) return;
    const since = Date.now() - pending.triedAt;
    // A clock set back leaves triedAt in the future: that must not hold the retry off for good.
    if (since >= 0 && since < VISIT_RETRY_MS) return;
    const c = await getConfigMany(["CLOUD_AUTH_FAILED", ...CLOUD_URL_KEYS] as const);
    // A revoked session answers 401 to every read: wait for the sign-in.
    if (c.CLOUD_AUTH_FAILED) return;
    await deleteUnusedUploads([], [], CLOUD_URL_KEYS.map((key) => c[key]));
  } catch (e) {
    console.warn("[images] cleanup retry failed:", e);
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
