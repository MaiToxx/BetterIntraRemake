/**
 * Orchestration of the public profile extras: decides whether they are
 * shown (viewer settings), renders the three parts (stylesheet, identity
 * block, particle effect) and cleans up when the profile changes.
 *
 * Two entry points, both called on every mutation pass of the profile page
 * (through visuals.ts):
 *   applyProfileExtras(raw, opts)  someone else's profile, `raw` comes from
 *                                  the worker and is untrusted
 *   applyOwnProfileExtras(login)   my own page, read from local settings so
 *                                  that the hub gives a live preview
 * The expensive part is memoised on its inputs; only the cheap, idempotent
 * identity mount runs each time (React may drop the block when it re-renders
 * the header).
 */
import { getConfigMany } from "../../../config.ts";
import { AVATAR_SELECTOR } from "../selectors.ts";
import {
  EXTRAS_KEYS,
  EXTRAS_STYLE_ID,
  LEVEL_FILL_SELECTOR,
  NAME_SELECTOR,
  type ProfileExtras,
} from "./extras.ts";
import { sanitizeProfileExtras } from "./extras-sanitize.ts";
import { buildExtrasCss } from "./extras-style.ts";
import { mountIdentity, showGreeting, unmountIdentity } from "./extras-identity.ts";
import { startEffect, stopEffect } from "./extras-effects.ts";

export interface ApplyExtrasOptions {
  /** Login of the profile being displayed. */
  login: string;
  /** True on the viewer's own profile / dashboard. */
  own: boolean;
  /** The owner set a header image: the header gradient must not replace it. */
  hasBackgroundImage?: boolean;
}

/**
 * Keep only the published keys with primitive values. Idempotent, so the
 * raw object can sit in the visuals cache and go through sanitizeVisualUrls
 * any number of times; the real validation is sanitizeProfileExtras().
 */
export function pickRawExtras(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of EXTRAS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const v = src[key];
    if (typeof v === "boolean") out[key] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "string" && v.length <= 512) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

type LastCall =
  | { kind: "own"; login: string }
  | { kind: "other"; raw: unknown; opts: ApplyExtrasOptions };

let memoKey = "";
let appliedPath = "";
let current: { extras: ProfileExtras; opts: ApplyExtrasOptions } | null = null;
let lastCall: LastCall | null = null;
/** Bumped when my own PROFILE_PUB_* settings change (invalidates the memo). */
let ownVersion = 0;
/** Bumped on every render request: a slower, older request must not win. */
let requestId = 0;
let watchTimer: ReturnType<typeof setInterval> | null = null;
let listenersInstalled = false;

function setStyle(css: string): void {
  let el = document.getElementById(EXTRAS_STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = EXTRAS_STYLE_ID;
    (document.head || document.documentElement).appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

function removeEverything(): void {
  current = null;
  setStyle("");
  unmountIdentity();
  stopEffect();
}

/** Remove everything the extras added to the page and forget the profile. */
export function clearProfileExtras(): void {
  requestId++;
  memoKey = "";
  lastCall = null;
  removeEverything();
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

/**
 * The Intra is a single-page app: leaving the profile without a reload must
 * take the particles and styles away with it.
 */
function watchNavigation(): void {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    if (location.pathname !== appliedPath) clearProfileExtras();
  }, 1500);
}

function installListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !lastCall) return;
    if (appliedPath && location.pathname !== appliedPath) {
      lastCall = null;
      return;
    }
    const viewerChanged =
      "PROFILE_SHOW_OTHERS_EXTRAS" in changes || "DISABLE_ANIMATIONS" in changes;
    const ownChanged =
      lastCall.kind === "own" &&
      (EXTRAS_KEYS.some((k) => k in changes) || "PROFILE_BACKGROUND_URL" in changes);
    if (!viewerChanged && !ownChanged) return;
    memoKey = "";
    if (lastCall.kind === "own") {
      ownVersion++;
      void applyOwnProfileExtras(lastCall.login);
    } else {
      void applyProfileExtras(lastCall.raw, lastCall.opts);
    }
  });
}

async function renderExtras(
  raw: unknown,
  opts: ApplyExtrasOptions,
  key: string,
): Promise<void> {
  const mine = ++requestId;
  const done = () => {
    memoKey = key;
    appliedPath = location.pathname;
  };

  const extras = sanitizeProfileExtras(raw);
  if (!extras) {
    removeEverything();
    done();
    return;
  }

  const c = await getConfigMany(["PROFILE_SHOW_OTHERS_EXTRAS", "DISABLE_ANIMATIONS"]);
  if (mine !== requestId) return; // superseded while storage was read
  if (!opts.own && c.PROFILE_SHOW_OTHERS_EXTRAS === false) {
    removeEverything();
    done();
    return;
  }

  const still = c.DISABLE_ANIMATIONS === true;
  let css = buildExtrasCss(extras, { hasBackgroundImage: !!opts.hasBackgroundImage });
  if (css && still) {
    css += `\nhtml ${NAME_SELECTOR}, html ${LEVEL_FILL_SELECTOR}, html ${AVATAR_SELECTOR}::before { animation: none !important; }`;
  }
  setStyle(css);

  current = { extras, opts };
  mountIdentity(extras, opts);
  showGreeting(extras, opts);

  if (still || extras.effect === "none") stopEffect();
  else startEffect(extras.effect, extras.effectIntensity, extras.effectColor);

  done();
  watchNavigation();
}

/** Memo hit: same profile, same data. Only make sure React kept the block. */
function refreshIfUnchanged(key: string): boolean {
  if (key !== memoKey || location.pathname !== appliedPath) return false;
  if (current) mountIdentity(current.extras, current.opts);
  return true;
}

/** True when these published values would render something on the page. */
export function extrasAreVisible(raw: unknown): boolean {
  return sanitizeProfileExtras(raw) !== null;
}

/**
 * Show (or clear, with a null `raw`) the extras of someone else's profile.
 * `raw` is the PROFILE_PUB_* object published by the owner, untrusted.
 */
export async function applyProfileExtras(
  raw: unknown,
  opts: ApplyExtrasOptions,
): Promise<void> {
  installListeners();
  lastCall = { kind: "other", raw, opts };
  const key = JSON.stringify([
    "other",
    raw ?? null,
    opts.login,
    opts.own,
    !!opts.hasBackgroundImage,
  ]);
  if (refreshIfUnchanged(key)) return;
  await renderExtras(raw, opts, key);
}

/** Show my own extras on my page, straight from local settings. */
export async function applyOwnProfileExtras(login: string): Promise<void> {
  installListeners();
  lastCall = { kind: "own", login };
  const key = JSON.stringify(["own", ownVersion, login]);
  if (refreshIfUnchanged(key)) return;
  const c = await getConfigMany([...EXTRAS_KEYS, "PROFILE_BACKGROUND_URL"]);
  if (lastCall?.kind !== "own" || lastCall.login !== login) return;
  await renderExtras(
    pickRawExtras(c),
    { login, own: true, hasBackgroundImage: !!c.PROFILE_BACKGROUND_URL },
    key,
  );
}
