/**
 * The hosts another student's images may be loaded from.
 *
 * A published avatar, banner, background, look background or friend avatar
 * is fetched by every viewer's browser straight from the host its author
 * chose, which then sees each viewer's IP address and user agent (the
 * friends widget does this on every Intra page). The list keeps that to
 * hosts that serve images for everyone anyway. The author's own storage
 * values are never filtered (they stay in the editor and on their own
 * profile); only what is shown to OTHER users goes through it.
 *
 * A "*." entry matches any subdomain (not the bare domain), a plain entry
 * matches exactly. Hostnames are compared lowercase and without a trailing
 * dot, as the URL parser normalises them.
 */
export const ALLOWED_IMAGE_HOSTS: readonly string[] = [
  "cdn.intra.42.fr",
  "*.intra.42.fr",
  "imgur.com",
  "i.imgur.com",
  "github.com",
  "*.githubusercontent.com",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "*.wikimedia.org",
  "images.unsplash.com",
  "i.ibb.co",
  "*.postimg.cc",
  "gyazo.com",
  "i.gyazo.com",
  "*.giphy.com",
  "*.tenor.com",
  "cdn.jsdelivr.net",
  "*.cloudfront.net",
  "*.gravatar.com",
  "*.googleusercontent.com",
];

const EXACT = new Set<string>();
const SUFFIXES: string[] = [];
for (const entry of ALLOWED_IMAGE_HOSTS) {
  if (entry.startsWith("*.")) SUFFIXES.push(entry.slice(1));
  else EXACT.add(entry);
}

/** Whether `hostname` (as `new URL(...).hostname` gives it) is on the list. */
export function isAllowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (EXACT.has(host)) return true;
  return SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/**
 * The hostname of `url` when it is not on the list, "" when it is (or when
 * the value is not a URL at all: the sanitiser rejects it for another
 * reason then). For the editor's hint.
 */
export function disallowedImageHost(url: string): string {
  try {
    const { hostname } = new URL(url.trim());
    return isAllowedImageHost(hostname) ? "" : hostname;
  } catch {
    return "";
  }
}
