/**
 * The longest URL another user's data may carry into the page. Signed CDN
 * URLs stay under 2 KB; the worker bounds its public strings the same way,
 * so a multi-megabyte value from an old record is dropped instead of parsed,
 * stored and interpolated for every viewer.
 */
export const MAX_REMOTE_URL_LENGTH = 2048;

/**
 * Return the URL if it is an absolute http(s) URL, otherwise an empty string.
 * Use it before putting any externally provided URL into an href.
 */
export function sanitizeHttpUrl(url: unknown): string {
  if (typeof url !== "string" || url.length > MAX_REMOTE_URL_LENGTH) return "";
  const raw = url.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}
