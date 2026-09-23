/**
 * Upload of a profile image (avatar, banner, background) to the worker,
 * which keeps one image per slot and serves it from its own origin. The
 * editor's URL field then holds that URL like any pasted one, so nothing
 * else in the visuals pipeline knows about uploads.
 */
import { getConfigMany } from "../../../core/config.ts";
import { workerFetch } from "../../../core/worker.ts";

export type ImageSlot = "avatar" | "banner" | "background";

/** The worker's cap; checked here too so a 5 MB photo fails before the upload. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

export async function uploadProfileImage(
  slot: ImageSlot,
  file: File,
): Promise<UploadResult> {
  if (!ACCEPTED.has(file.type)) {
    return { ok: false, error: "Choose a PNG, JPEG, GIF or WebP image." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "The image is over 2 MB. Resize it, or paste a link instead." };
  }
  const { CLOUD_LOGIN, CLOUD_TOKEN } = await getConfigMany(["CLOUD_LOGIN", "CLOUD_TOKEN"]);
  if (!CLOUD_LOGIN || !CLOUD_TOKEN) {
    return { ok: false, error: "Connect with 42 first (bottom of this editor) to upload images." };
  }
  const res = await workerFetch(`/api/v1/private/images?slot=${slot}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type },
    auth: { login: CLOUD_LOGIN, token: CLOUD_TOKEN },
    timeoutMs: 30_000,
  });
  if (res.status === 0) return { ok: false, error: "Could not reach the Better Intra server." };
  if (res.status === 401) return { ok: false, error: "Your session expired: reconnect, then retry." };
  if (res.status === 413) return { ok: false, error: "The image is over 2 MB." };
  if (res.status === 429) return { ok: false, error: "Too many uploads: wait a minute." };
  const url = (res.json as { url?: unknown } | null)?.url;
  if (!res.ok || typeof url !== "string") {
    return { ok: false, error: `Upload failed (${res.status}).` };
  }
  return { ok: true, url };
}
