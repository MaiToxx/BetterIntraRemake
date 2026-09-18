/**
 * Raw PROFILE_PUB_* settings -> ProfileExtras | null.
 *
 * The raw object is written by ANOTHER USER (it travels through the worker
 * untouched), so nothing of it is trusted: the result is rebuilt key by key
 * and only ever contains
 *   - plain text, cleaned of control / bidi / invisible characters and capped
 *     (rendered through text bindings by extras-identity.ts, never as HTML),
 *   - strict #rrggbb colours, clamped integers and values looked up in the
 *     enums of the contract (the only things extras-style.ts puts in CSS),
 *   - https URLs that this file either built itself from a validated user
 *     name or got back, normalised, from the URL parser.
 * The owner's own page goes through the very same function, so what they see
 * in the live preview is exactly what visitors get.
 *
 * Everything here is pure (no DOM, no storage) and idempotent: sanitising a
 * configuration rebuilt from a sanitised result gives the same result.
 */
import { CONFIG_DEFAULT } from "../../../config.ts";
import { sanitizeHexColor } from "../../../utils/css-sanitize.ts";
import { BG_PRESETS } from "../../customize/customize.ts";
import {
  EFFECTS,
  FRAMES,
  INTENSITIES,
  LEVEL_STYLES,
  LIMITS,
  NAME_FONTS,
  NAME_STYLES,
  type ExtrasKey,
  type LinkKind,
  type ProfileExtras,
  type ProfileLink,
} from "./extras.ts";

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/**
 * Characters that are removed outright:
 *   - C0 / C1 controls and DEL, except the ones that are white space (they
 *     become a space below, so that "a\nb" does not turn into "ab"),
 *   - bidi embeddings / overrides (U+202A-202E) and isolates (U+2066-2069):
 *     they let a stranger reorder the text around theirs ("evil\u202Egnp.exe"),
 *   - U+200B, U+200C, U+FEFF: invisible padding, used to fake empty-looking or
 *     look-alike values. U+200D stays: emoji sequences are built with it,
 *   - lone surrogates (with the `u` flag the class only matches unpaired
 *     ones): they are not text and make encodeURIComponent() throw.
 */
const REMOVED_CHARS =
  /[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\u200B\u200C\u202A-\u202E\u2066-\u2069\uFEFF\uD800-\uDFFF]/gu;

/** Every white space run, line breaks and NEL (U+0085) included. */
const WHITESPACE_RUN = /[\s\u0085]+/gu;

/**
 * "Zalgo" guard: a base character keeps at most 4 combining marks. Real
 * scripts and emoji sequences stay below that; a stack of 50 marks only
 * serves to paint over the rest of the page.
 */
const MARK_OVERFLOW = /(\p{M}{4})\p{M}+/gu;

/** A cut can leave a dangling joiner or space at the end. */
const DANGLING_END = /[\u200D\s]+$/u;

/** Cut to `max` code points: a surrogate pair is never split. */
function capCodePoints(text: string, max: number): string {
  // length counts UTF-16 units, always >= the number of code points
  if (text.length <= max) return text;
  let end = 0;
  let count = 0;
  for (const ch of text) {
    if (count === max) break;
    end += ch.length;
    count++;
  }
  return text.slice(0, end);
}

/**
 * Plain, single-line text of at most `max` code points. Anything that is not
 * a string gives "". The order matters for idempotence: characters are
 * removed BEFORE the NFC pass (removing the U+200B of "e\u200B\u0301" makes
 * a new composable pair) and the cut comes last (a prefix of an NFC string
 * is still NFC).
 */
export function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const limit = Number.isFinite(max) ? Math.floor(max) : 0;
  if (limit <= 0) return "";
  const clean = value
    .replace(REMOVED_CHARS, "")
    .replace(WHITESPACE_RUN, " ")
    .normalize("NFC")
    .replace(MARK_OVERFLOW, "$1")
    .trim();
  return capCodePoints(clean, limit).replace(DANGLING_END, "");
}

/**
 * Flair is a row of emoji / symbols, not a second bio: a token holding ASCII
 * letters or digits is dropped, and so is anything that means something in
 * HTML, CSS or a URL (belt and braces, the tokens are text-bound anyway).
 */
const FLAIR_FORBIDDEN = /[\p{L}\p{N}<>&"'`=/\\]/u;

/**
 * "🔥 🚀 ✨" -> ["🔥", "🚀", "✨"]. Tokens that are too long are dropped rather
 * than cut: half an emoji sequence is a different emoji.
 */
export function parseFlair(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const out: string[] = [];
  for (const part of value.split(WHITESPACE_RUN)) {
    // one code point more than allowed, so that an over-long token is still
    // over-long after the cut and gets dropped below
    const token = sanitizeText(part, LIMITS.flairItemLength + 1);
    if (!token || token.length > LIMITS.flairItemLength) continue;
    if (FLAIR_FORBIDDEN.test(token)) continue;
    out.push(token);
    if (out.length >= LIMITS.flairItems) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/** Longest raw link value looked at (longer than any accepted one). */
const LINK_INPUT_MAX = 300;
const LINK_LABEL_MAX = 100;
const WEBSITE_HREF_MAX = 200;
/**
 * The label of a website is its host name, and the renderer may have to
 * shorten a long one: "paypal.com.aaaaaaaaaaaaaaaa…" must not be possible.
 */
const WEBSITE_HOST_MAX = 64;

const GITHUB_USER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITLAB_USER = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const LINKEDIN_SLUG = /^[A-Za-z0-9_-]{3,100}$/;
const DISCORD_HANDLE = /^[A-Za-z0-9_.]{2,32}(?:#[0-9]{4})?$/;

/**
 * Profile URLs, with or without scheme. They only serve to EXTRACT the user
 * name: the href is always rebuilt from a constant and the validated name,
 * never copied from the input. Anything after the name other than a trailing
 * slash, a query or a hash (a repository, "/../") makes the URL not match.
 */
const GITHUB_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/?(?:[?#].*)?$/i;
const GITLAB_URL = /^(?:https?:\/\/)?(?:www\.)?gitlab\.com\/([^/?#]+)\/?(?:[?#].*)?$/i;
const LINKEDIN_URL =
  /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#]+)\/?(?:[?#].*)?$/i;

/** "scheme://": the value is parsed as it is. */
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/**
 * "example.com", "www.example.com:8443/me": gets "https://" prepended.
 * "javascript:alert(1)", "user:pass@host" and "//host" do not look like that.
 */
const DOMAIN_LIKE = /^[^\s:/?#@\\]+\.[^\s:/?#@\\]+(?::\d{1,5})?(?:[/?#].*)?$/;
/** Never left in a URL by the parser, except ' and \ in a query or hash. */
const HREF_FORBIDDEN = /[\s"'<>`\\]/;

/** Value of a handle field: cleaned text without its leading "@". */
function readHandle(value: unknown): string {
  const raw = sanitizeText(value, LINK_INPUT_MAX);
  return raw.startsWith("@") ? raw.slice(1) : raw;
}

/** The user part of a profile URL, or the value itself (a bare user name). */
function extractUser(raw: string, profileUrl: RegExp): string {
  const match = profileUrl.exec(raw);
  return match ? match[1] : raw;
}

/**
 * Last gate of every link: the label is text, the href is either empty or an
 * https URL that the parser gives back unchanged (what is shown in the
 * status bar is what gets opened).
 */
function makeLink(kind: LinkKind, label: string, href: string): ProfileLink | null {
  const text = sanitizeText(label, LINK_LABEL_MAX);
  if (!text) return null;
  if (href !== "") {
    try {
      const parsed = new URL(href);
      if (parsed.protocol !== "https:" || parsed.href !== href) return null;
    } catch {
      return null;
    }
  }
  return { kind, label: text, href };
}

function normalizeWebsite(value: unknown): ProfileLink | null {
  const raw = sanitizeText(value, LINK_INPUT_MAX);
  let candidate: string;
  if (EXPLICIT_SCHEME.test(raw)) candidate = raw;
  else if (DOMAIN_LIKE.test(raw)) candidate = `https://${raw}`;
  else return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // "https://paypal.com@evil.example" opens evil.example
  if (url.username !== "" || url.password !== "") return null;
  const host = url.hostname;
  // a dot with something on both sides: no "localhost", no "[::1]", no ".com"
  if (/\s/.test(host) || !/[^.]\.[^.]/.test(host)) return null;
  if (host.length > WEBSITE_HOST_MAX) return null;
  const href = url.href;
  if (href.length > WEBSITE_HREF_MAX || HREF_FORBIDDEN.test(href)) return null;
  return makeLink("website", host.replace(/^www\./, ""), href);
}

/**
 * One link field -> a link that is safe to render, or null when the value is
 * empty or not what the field expects.
 */
export function normalizeLink(kind: LinkKind, value: unknown): ProfileLink | null {
  switch (kind) {
    case "github": {
      const user = extractUser(readHandle(value), GITHUB_URL);
      if (!GITHUB_USER.test(user)) return null;
      return makeLink(kind, user, `https://github.com/${user}`);
    }
    case "gitlab": {
      const user = extractUser(readHandle(value), GITLAB_URL);
      if (!GITLAB_USER.test(user)) return null;
      return makeLink(kind, user, `https://gitlab.com/${user}`);
    }
    case "linkedin": {
      const slug = extractUser(readHandle(value), LINKEDIN_URL);
      if (!LINKEDIN_SLUG.test(slug)) return null;
      return makeLink(kind, slug, `https://www.linkedin.com/in/${slug}`);
    }
    case "website":
      return normalizeWebsite(value);
    case "discord": {
      const handle = readHandle(value);
      if (!DISCORD_HANDLE.test(handle)) return null;
      // no URL opens a Discord profile from a handle: it is copied instead
      return makeLink(kind, handle, "");
    }
    default:
      // a kind that is not in the contract (the caller is not type-checked)
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Whole object                                                        */
/* ------------------------------------------------------------------ */

type ColorKey =
  | "PROFILE_PUB_NAME_COLOR"
  | "PROFILE_PUB_NAME_COLOR_2"
  | "PROFILE_PUB_FRAME_COLOR"
  | "PROFILE_PUB_FRAME_COLOR_2"
  | "PROFILE_PUB_LEVEL_COLOR"
  | "PROFILE_PUB_LEVEL_COLOR_2";

/** Only if CONFIG_DEFAULT itself stops being a hex colour. */
const LAST_RESORT_COLOR = "#00babc";

const LINK_FIELDS: ReadonlyArray<readonly [LinkKind, ExtrasKey]> = [
  ["github", "PROFILE_PUB_LINK_GITHUB"],
  ["gitlab", "PROFILE_PUB_LINK_GITLAB"],
  ["linkedin", "PROFILE_PUB_LINK_LINKEDIN"],
  ["website", "PROFILE_PUB_LINK_WEBSITE"],
  ["discord", "PROFILE_PUB_LINK_DISCORD"],
];

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * An object literal / JSON object, from this realm or another one (the
 * prototype of an Object.prototype is null). Arrays, Maps, class instances
 * and objects inheriting values from a custom prototype are refused.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype || Object.getPrototypeOf(proto) === null;
}

function pickEnum<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Finite number or plain decimal string ("55", not "0x37" or "1e9") -> integer in [0, max]. */
function clampInt(value: unknown, max: number): number {
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\s*[+-]?\d+(?:\.\d+)?\s*$/.test(value)) n = Number(value);
  else return 0;
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(0, Math.round(n)));
}

/**
 * Rebuild the extras from raw settings keyed by the PROFILE_PUB_* names (the
 * worker's `extras` field for someone else, chrome.storage for the owner).
 * null = nothing to show: not an object, publication switched off, or every
 * value empty / neutral.
 */
export function sanitizeProfileExtras(raw: unknown): ProfileExtras | null {
  if (!isPlainObject(raw)) return null;
  // own properties only: a polluted Object.prototype must not publish anything
  const read = (key: ExtrasKey): unknown => (hasOwn.call(raw, key) ? raw[key] : undefined);
  const color = (key: ColorKey): string =>
    sanitizeHexColor(read(key)) || sanitizeHexColor(CONFIG_DEFAULT[key]) || LAST_RESORT_COLOR;

  if (read("PROFILE_PUB_ENABLED") === false) return null;

  const links: ProfileLink[] = [];
  for (const [kind, key] of LINK_FIELDS) {
    const link = normalizeLink(kind, read(key));
    if (link) links.push(link);
  }

  const gradient = read("PROFILE_PUB_BANNER_GRADIENT");
  const tint = sanitizeHexColor(read("PROFILE_PUB_EFFECT_COLOR"));

  const extras: ProfileExtras = {
    bio: sanitizeText(read("PROFILE_PUB_BIO"), LIMITS.bio),
    statusEmoji: sanitizeText(read("PROFILE_PUB_STATUS_EMOJI"), LIMITS.statusEmoji),
    statusText: sanitizeText(read("PROFILE_PUB_STATUS_TEXT"), LIMITS.statusText),
    pronouns: sanitizeText(read("PROFILE_PUB_PRONOUNS"), LIMITS.pronouns),
    flair: parseFlair(read("PROFILE_PUB_FLAIR")),
    greeting: sanitizeText(read("PROFILE_PUB_GREETING"), LIMITS.greeting),
    links,

    nameStyle: pickEnum(NAME_STYLES, read("PROFILE_PUB_NAME_STYLE"), "default"),
    nameColor: color("PROFILE_PUB_NAME_COLOR"),
    nameColor2: color("PROFILE_PUB_NAME_COLOR_2"),
    nameFont: pickEnum(NAME_FONTS, read("PROFILE_PUB_NAME_FONT"), "default"),

    frame: pickEnum(FRAMES, read("PROFILE_PUB_FRAME"), "none"),
    frameColor: color("PROFILE_PUB_FRAME_COLOR"),
    frameColor2: color("PROFILE_PUB_FRAME_COLOR_2"),

    levelStyle: pickEnum(LEVEL_STYLES, read("PROFILE_PUB_LEVEL_STYLE"), "default"),
    levelColor: color("PROFILE_PUB_LEVEL_COLOR"),
    levelColor2: color("PROFILE_PUB_LEVEL_COLOR_2"),

    // own keys only: "constructor" and "__proto__" are `in` BG_PRESETS too
    bannerGradient:
      typeof gradient === "string" && hasOwn.call(BG_PRESETS, gradient) ? gradient : "none",
    bannerDim: clampInt(read("PROFILE_PUB_BANNER_DIM"), LIMITS.bannerDimMax),
    bannerBlur: clampInt(read("PROFILE_PUB_BANNER_BLUR"), LIMITS.bannerBlurMax),
    cardGlow: read("PROFILE_PUB_CARD_GLOW") === true,

    effect: pickEnum(EFFECTS, read("PROFILE_PUB_EFFECT"), "none"),
    effectIntensity: pickEnum(INTENSITIES, read("PROFILE_PUB_EFFECT_INTENSITY"), "medium"),
    effectColor: read("PROFILE_PUB_EFFECT_TINT") === true ? tint : "",
  };
  return hasVisibleExtras(extras) ? extras : null;
}

/**
 * False when rendering the extras would change nothing on the page. Colours,
 * the effect intensity and the effect tint do not count: on their own (style
 * "default", frame "none", effect "none") they are not used.
 */
export function hasVisibleExtras(x: ProfileExtras): boolean {
  return (
    x.bio !== "" ||
    x.statusEmoji !== "" ||
    x.statusText !== "" ||
    x.pronouns !== "" ||
    x.greeting !== "" ||
    x.flair.length > 0 ||
    x.links.length > 0 ||
    x.nameStyle !== "default" ||
    x.nameFont !== "default" ||
    x.frame !== "none" ||
    x.levelStyle !== "default" ||
    x.bannerGradient !== "none" ||
    x.bannerDim !== 0 ||
    x.bannerBlur !== 0 ||
    x.cardGlow ||
    x.effect !== "none"
  );
}
