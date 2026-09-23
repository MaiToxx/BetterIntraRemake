/**
 * The editor's image URL histories (PROFILE_IMAGE_HISTORY, _BANNER_, and
 * _BACKGROUND_): newest first, ten entries at most.
 *
 * WHY a module of its own, with no imports: the editor (profile-modal-form.ts)
 * and the storage listener (visuals-cache.ts) both add to these lists and
 * must agree on what counts as the same entry.
 */

/**
 * An uploaded image is served at /img/<login hash>/<slot>?v=<n>, and the
 * worker keeps one image per slot: every older ?v= of a slot shows the newest
 * bytes, or nothing once the upload is deleted. Such entries are one image,
 * so only the newest is kept.
 */
const UPLOAD_PATH_RE = /^\/img\/[a-f0-9]{64}\/(?:avatar|banner|background)$/;

/** origin + path of an uploaded image's URL, or null for any other URL. */
export function uploadKey(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    const parsed = new URL(url);
    return UPLOAD_PATH_RE.test(parsed.pathname) ? parsed.origin + parsed.pathname : null;
  } catch {
    return null;
  }
}

/** Puts `url` first in a url history of at most ten distinct entries. */
export function addToHistory(url: string, history: string[]): string[] {
  if (!url) return history;
  const key = uploadKey(url);
  const filtered = history.filter(
    (h) => h !== url && (key === null || uploadKey(h) !== key),
  );
  return [url, ...filtered].slice(0, 10);
}
