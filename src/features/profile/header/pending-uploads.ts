/**
 * The images picked in one open editor, held until Save.
 *
 * WHY not upload when the file is picked: the worker keeps one image per slot
 * and serves it to every visitor under the saved URL, whatever its ?v= says.
 * Uploading to try a picture out therefore published it, even after Cancel,
 * and spent one of the day's shared KV writes. Now a pick only reads the file
 * for a local preview; Save uploads the slots that changed and stores the
 * URLs the worker answers.
 *
 * One instance per dialog: a status or an error never outlives its editor,
 * and a result that lands after the editor closed is dropped.
 */
import {
  IMAGE_SLOTS,
  prepareUpload,
  uploadProfileImage,
  type ImageSlot,
} from "./image-upload.ts";
import { readLocalPreview } from "./local-preview.ts";

export interface PendingImage {
  name: string;
  blob: Blob;
  /** data: URL for the owner's preview only (local-preview.ts). */
  preview: string;
  /** Set once uploaded, so a Save retried after another slot failed does not send it again. */
  uploadedUrl?: string;
}

export interface SlotStatus {
  text: string;
  busy: boolean;
}

export const SLOT_LABELS: Record<ImageSlot, string> = {
  avatar: "Avatar",
  banner: "Banner",
  background: "Background",
};

export type UploadAllResult =
  | { ok: true; urls: Partial<Record<ImageSlot, string>> }
  | { ok: false; closed: true }
  | { ok: false; closed: false; slot: ImageSlot; error: string };

export interface PendingUploads {
  readonly closed: boolean;
  /** A picked file is still being read (a big JPEG takes a moment to shrink). */
  readonly reading: boolean;
  /**
   * Slots this editor sent to the worker. Their bytes are live under /img/
   * whether or not the Save completes, so the caller can remove what ends up
   * unused (upload-cleanup.ts).
   */
  readonly uploaded: ReadonlySet<ImageSlot>;
  get(slot: ImageSlot): PendingImage | undefined;
  status(slot: ImageSlot): SlotStatus | undefined;
  /** The previews to paint on the page, by slot. */
  previews(): Partial<Record<ImageSlot, string>>;
  pick(slot: ImageSlot, file: File): Promise<void>;
  /** The field got another value (typed, from the history, Color mode): the file is dropped. */
  discard(slot: ImageSlot): void;
  /**
   * Uploads every picked file not uploaded yet, one after the other (they
   * share the worker's write limit with the settings push that follows).
   * Stops at the first failure, with its error shown next to the field.
   */
  uploadAll(): Promise<UploadAllResult>;
  /** Saved: the fields now hold the uploaded URLs. */
  clear(): void;
  /** The editor closed: anything still running is dropped when it lands. */
  close(): void;
}

/** `onChange` re-renders the editor (a status, a preview or an error changed). */
export function createPendingUploads(onChange: () => void): PendingUploads {
  const files = new Map<ImageSlot, PendingImage>();
  const statuses = new Map<ImageSlot, SlotStatus>();
  // Latest pick per slot: a slow read of an older pick must not land over a newer one.
  const picks = new Map<ImageSlot, number>();
  const uploaded = new Set<ImageSlot>();
  // Slots whose latest pick is still being read.
  const reading = new Set<ImageSlot>();
  let closed = false;

  const bump = (slot: ImageSlot) => {
    const seq = (picks.get(slot) ?? 0) + 1;
    picks.set(slot, seq);
    return seq;
  };
  const clear = () => {
    files.clear();
    statuses.clear();
    reading.clear();
  };

  return {
    get closed() {
      return closed;
    },
    get reading() {
      return reading.size > 0;
    },
    uploaded,
    get: (slot) => files.get(slot),
    status: (slot) => statuses.get(slot),
    previews() {
      const out: Partial<Record<ImageSlot, string>> = {};
      for (const [slot, p] of files) out[slot] = p.preview;
      return out;
    },

    async pick(slot, file) {
      if (closed) return;
      const seq = bump(slot);
      reading.add(slot);
      statuses.set(slot, { text: `Reading ${file.name}…`, busy: true });
      onChange();
      const prepared = await prepareUpload(slot, file);
      const preview = prepared.ok ? await readLocalPreview(prepared.blob) : "";
      if (closed || picks.get(slot) !== seq) return;
      reading.delete(slot);
      if (!prepared.ok || !preview) {
        const error = prepared.ok ? "Could not read this image." : prepared.error;
        statuses.set(slot, { text: error, busy: false });
      } else {
        files.set(slot, { name: file.name, blob: prepared.blob, preview });
        statuses.delete(slot);
      }
      onChange();
    },

    discard(slot) {
      bump(slot);
      reading.delete(slot);
      files.delete(slot);
      statuses.delete(slot);
    },

    async uploadAll() {
      const urls: Partial<Record<ImageSlot, string>> = {};
      for (const slot of IMAGE_SLOTS) {
        const pending = files.get(slot);
        if (!pending) continue;
        if (!pending.uploadedUrl) {
          statuses.set(slot, { text: `Uploading ${pending.name}…`, busy: true });
          onChange();
          const result = await uploadProfileImage(slot, pending.blob);
          if (result.ok) uploaded.add(slot);
          if (closed) return { ok: false, closed: true };
          if (!result.ok) {
            statuses.set(slot, { text: result.error, busy: false });
            onChange();
            return { ok: false, closed: false, slot, error: result.error };
          }
          pending.uploadedUrl = result.url;
          statuses.delete(slot);
          onChange();
        }
        urls[slot] = pending.uploadedUrl;
      }
      return { ok: true, urls };
    },

    clear,
    close() {
      closed = true;
      clear();
    },
  };
}
