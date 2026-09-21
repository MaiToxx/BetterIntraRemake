/**
 * Validators for values that end up inside CSS text (url(), colours).
 *
 * They are used for settings received from other users through the cloud API
 * (profile visuals, shared looks) as well as for the user's own settings, so
 * that anything interpolated into a <style> element is either a normalised
 * http(s) URL, a plain colour or a known keyword.
 */

/**
 * Absolute http(s) URL, normalised by the URL parser (which percent-encodes
 * quotes and whitespace) so that it can never end a CSS url("...") string.
 *
 * The result is only safe INSIDE A DOUBLE-QUOTED url("..."): use cssUrl()
 * below, or write the quotes yourself. ')' ';' ':' '!' and "'" are left alone
 * because the parser keeps them and real image URLs contain them (Wikimedia
 * "..._(foo).png"). Percent-encoding them here would change the stored URL
 * strings that callers compare (custom avatar vs 42 picture, visuals cache).
 * In an unquoted url(...) a ')' closes the token and what follows becomes new
 * declarations: a friend's avatar URL once added position:fixed and a huge
 * z-index to the friends widget that way.
 */
export function sanitizeCssUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    const href = parsed.href;
    if (/["\\\s]/.test(href)) return ""; // defensive: the parser already encodes these
    return href;
  } catch {
    return "";
  }
}

/**
 * A ready-to-use `url("...")` CSS value for `value`, or "" when it is not a
 * plain http(s) URL. Quoting is part of the sanitising (see sanitizeCssUrl),
 * so building the value here means no caller can forget it.
 */
export function cssUrl(value: unknown): string {
  const href = sanitizeCssUrl(value);
  return href ? `url("${href}")` : "";
}

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba()/hsl()/hsla() with numeric args, or a keyword. */
export function sanitizeCssColor(value: unknown, keywords?: Set<string>): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
  if (/^(?:rgba?|hsla?)\(\s*[\d.%\s,/-]+\)$/i.test(raw)) return raw;
  if (keywords?.has(raw.toLowerCase())) return raw.toLowerCase();
  return "";
}

/** Strict 6-digit hex, for values that are further processed (e.g. alpha appended). */
export function sanitizeHexColor(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : "";
}
