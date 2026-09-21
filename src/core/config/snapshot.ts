/**
 * The settings snapshot: every setting fetched in one storage read per
 * context, then served from memory and kept equal to storage.
 *
 * Owns all of the snapshot's state. access.ts asks it for the snapshot
 * (snapshotFor) and for a private copy of a stored value (copyRaw);
 * src/core/config.ts switches it on with initSnapshot(), once, when it is
 * evaluated. Code that imports this module without going through config.ts
 * gets no snapshot, only the direct reads of the FALLBACK below.
 */
import { CONFIG_DEFAULT } from "./defaults.ts";

// ---------------------------------------------------------------------------
// Settings snapshot: one storage round-trip per context instead of one per read
// ---------------------------------------------------------------------------
//
// WHY. Each getConfig() used to be one chrome.storage.local.get(), i.e. one IPC
// to the extension process. The profile page awaits dozens of them in a row
// before it is interactive, and the cloud-sync upload awaits one per synced key
// (~130). Now the first read in a context fetches every setting at once and the
// later reads are served from memory.
//
// WHAT IS FETCHED. The keys of CONFIG_DEFAULT, in one keyed get(), not
// get(null). The same storage area also holds caches that are none of
// getConfig()'s business and can be big (whole cluster SVGs, badge maps, the
// campus list): get(null) would copy all of them into every Intra tab on every
// page load and keep them in memory. A keyed get, like get(null), returns only
// the keys that were actually written, so every other key still falls back to
// CONFIG_DEFAULT in normalizeConfigValue() (access.ts), JSON-string parsing and
// PROFILE_CARD_ORDER fix-up included. A key outside CONFIG_DEFAULT (the settings
// UI casts a few dynamic ones) is not in the snapshot and keeps the direct get.
//
// NEVER STALE. Three mechanisms keep the snapshot equal to storage.
//  1. chrome.storage.onChanged (area "local") applies every change and removal
//     made by any context: the popup, the service worker, another tab.
//  2. Writes made in THIS context are applied at the moment they are issued.
//     onChanged alone is not enough for them. About 76 call sites write with
//     `chrome.storage.local.set / remove / clear`, some read the key straight
//     back (profile.modal.ts stores the cloud visuals, then reads them with
//     getConfig(); hubSettings.storage.ts rewrites ACTIVE_SCRIPTS at start-up
//     and shortcuts.ts reads it a moment later), and no browser promises that
//     the onChanged event reaches the writer before its set() promise
//     resolves. A "recently written keys" list would need to see those writes
//     just the same, and the call sites must not change, so this module wraps
//     the three methods once (installWriteObserver). The wrapper records the
//     write, then calls the original with the same arguments and `this` and
//     hands back its result. setConfig() (access.ts) is the typed way in for new
//     code.
//  3. What cannot be mirrored exactly drops the whole snapshot, and the next
//     read fetches it again: a write that fails (rejected promise or
//     synchronous throw), a value that is not plain JSON data (Chrome and
//     Firefox store Dates, Maps, undefined or -Infinity differently, so only
//     storage itself knows what was kept), a callback-style call (its failure
//     only shows in runtime.lastError).
// Ordering is safe: onChanged events arrive in commit order and each one
// overwrites its key, so a write recorded early is corrected by any later write
// from anywhere. The listener is registered when src/core/config.ts is
// evaluated (initSnapshot() is its last statement), before any feature
// registers its own (they all import config.ts), and listeners run in
// registration order: when customize.ts or theme-manager.ts re-read settings
// from their own onChanged handlers, the snapshot is already up to date.
//
// THREE CONTEXTS. The content script, the popup and the service worker each
// evaluate this module and so each get their own snapshot, listener and
// wrapper. That is fine: every context also receives the onChanged events of
// the others. A suspended service worker loses its globals; when it restarts,
// the module is evaluated again and the first read simply refills the snapshot.
// An orphaned content script (extension reloaded under an open tab, so
// chrome.runtime.id is gone) goes back to direct reads, which fail as before.
//
// FALLBACK. Without onChanged (the unit-test mock in tests/setup.ts has none),
// if the storage methods cannot be wrapped, or if another copy of this module
// already wrapped them (WRITE_WRAPPER_MARK), there is no snapshot at all and
// every read is the direct get it always was. A cache that nothing repairs
// would serve stale values, so it is off rather than half on.

/** Every key getConfig() knows; only these live in the snapshot. */
const SNAPSHOT_KEYS: readonly string[] = Object.keys(CONFIG_DEFAULT);
const SNAPSHOT_KEY_SET: ReadonlySet<string> = new Set(SNAPSHOT_KEYS);
/** Marks a removed key in `overlay`. */
const REMOVED = Symbol("removed");
/** jsonCopy() result for a value that is not plain JSON data. */
const NOT_JSON = Symbol("not-json");

/** The onChanged listener and the write wrapper are both in place. */
let cacheEnabled = false;
/** Raw stored values, exactly as get() returns them; null until loaded. */
let snapshot: Map<string, unknown> | null = null;
/** The one load in flight, shared by every concurrent reader. */
let loading: Promise<Map<string, unknown>> | null = null;
/** Changes seen while `loading` was in flight, applied on top of its result. */
let overlay = new Map<string, unknown>();
/** A clear() happened while `loading` was in flight: drop its result. */
let overlayCleared = false;
/** Bumped by resetConfigCache(), so a load started before it is discarded. */
let generation = 0;

/** initSnapshot() already ran in this context. */
let initialised = false;

function cacheUsable(): boolean {
  return cacheEnabled && typeof chrome.runtime?.id === "string";
}

/**
 * A fresh copy, as every get() returned one: callers may mutate what they get.
 * Stored settings are plain JSON data, copied here in this script's own realm;
 * structuredClone() only for anything else (in a Firefox content script it can
 * resolve to the page window's, which would hand back the page's objects).
 */
export function copyRaw(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const copy = jsonCopy(value);
  return copy === NOT_JSON ? structuredClone(value) : copy;
}

/**
 * Deep copy of `value` if it is plain JSON data (what both browsers store and
 * give back unchanged), NOT_JSON otherwise.
 */
function jsonCopy(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : NOT_JSON;
  if (typeof value !== "object" || depth > 64) return NOT_JSON;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return NOT_JSON;
      const item = jsonCopy(value[i], depth + 1);
      if (item === NOT_JSON) return NOT_JSON;
      out.push(item);
    }
    return out;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return NOT_JSON;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key === "__proto__") return NOT_JSON;
    const item = jsonCopy((value as Record<string, unknown>)[key], depth + 1);
    if (item === NOT_JSON) return NOT_JSON;
    out[key] = item;
  }
  return out;
}

/** Record one key's new raw value (or REMOVED), whatever the load state. */
function applyChange(key: string, value: unknown): void {
  if (!SNAPSHOT_KEY_SET.has(key)) return;
  if (snapshot) {
    if (value === REMOVED) snapshot.delete(key);
    else snapshot.set(key, value);
  } else if (loading) {
    overlay.set(key, value);
  }
  // Neither loaded nor loading: the next load will read storage after this.
}

function applyClear(): void {
  if (snapshot) {
    snapshot.clear();
  } else if (loading) {
    overlay.clear();
    overlayCleared = true;
  }
}

function loadSnapshot(): Promise<Map<string, unknown>> {
  if (snapshot) return Promise.resolve(snapshot);
  if (loading) return loading;
  const gen = generation;
  // Left over from a load that failed: this get is issued after those changes
  // and will contain them, or newer values the overlay must not undo.
  overlay = new Map();
  overlayCleared = false;
  const pending = chrome.storage.local.get([...SNAPSHOT_KEYS]).then(
    (res): Map<string, unknown> | Promise<Map<string, unknown>> => {
      // resetConfigCache() ran meanwhile: this answer may predate what caused it.
      if (gen !== generation) return loadSnapshot();
      const map = new Map<string, unknown>();
      if (res && !overlayCleared) {
        for (const key of SNAPSHOT_KEYS) {
          const value = (res as Record<string, unknown>)[key];
          if (value !== undefined) map.set(key, value);
        }
      }
      for (const [key, value] of overlay) {
        if (value === REMOVED) map.delete(key);
        else map.set(key, value);
      }
      overlay = new Map();
      overlayCleared = false;
      snapshot = map;
      loading = null;
      return map;
    },
    (error: unknown) => {
      if (gen === generation) loading = null;
      throw error;
    },
  );
  loading = pending;
  return pending;
}

/**
 * The snapshot if it can serve these keys, null for the direct get. Returned
 * synchronously whenever possible: without a snapshot the direct get starts in
 * the same tick as it always did, and a loaded snapshot costs no extra await.
 */
export function snapshotFor(
  keys: readonly string[],
): Map<string, unknown> | null | Promise<Map<string, unknown> | null> {
  if (!cacheUsable() || !keys.every((k) => SNAPSHOT_KEY_SET.has(k))) return null;
  // A failed bulk read falls back to the per-call get, which fails or not as before.
  return snapshot ?? loadSnapshot().catch(() => null);
}

/**
 * Drop the snapshot: the next read fetches every setting again. For tests, and
 * for code that rewrites storage behind this module's back.
 */
export function resetConfigCache(): void {
  generation++;
  snapshot = null;
  loading = null;
  overlay = new Map();
  overlayCleared = false;
}

// -- this context's own writes (see "NEVER STALE", point 2) -----------------

/** @returns whether the write concerns the snapshot, i.e. a failure must drop it. */
function recordSet(items: unknown, hasCallback: boolean): boolean {
  if (!cacheEnabled || items === null || typeof items !== "object") return false;
  const copies: [string, unknown][] = [];
  for (const key of Object.keys(items)) {
    if (!SNAPSHOT_KEY_SET.has(key)) continue;
    const copy = hasCallback
      ? NOT_JSON
      : jsonCopy((items as Record<string, unknown>)[key]);
    if (copy === NOT_JSON) {
      resetConfigCache();
      return true;
    }
    copies.push([key, copy]);
  }
  for (const [key, copy] of copies) applyChange(key, copy);
  return copies.length > 0;
}

function recordRemove(keys: unknown, hasCallback: boolean): boolean {
  if (!cacheEnabled) return false;
  const list =
    typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : [];
  const ours = list.filter(
    (k): k is string => typeof k === "string" && SNAPSHOT_KEY_SET.has(k),
  );
  if (ours.length === 0) return false;
  if (hasCallback) resetConfigCache();
  else for (const key of ours) applyChange(key, REMOVED);
  return true;
}

function recordClear(hasCallback: boolean): boolean {
  if (!cacheEnabled) return false;
  if (hasCallback) resetConfigCache();
  else applyClear();
  return true;
}

type WriteMethod = "set" | "remove" | "clear";
type AnyFn = (...args: unknown[]) => unknown;

/**
 * Set on each of the three wrappers. Symbol.for() gives every copy of this
 * module in the realm the same key, so a second copy sees that the methods
 * are already wrapped and stays on direct reads (no snapshot, no listener)
 * instead of wrapping them again, which would record every write twice into
 * two snapshots. The content script is split into ES module chunks that must
 * share ONE instance of this module (docs/CODE-SPLITTING.md, rule 5): this is
 * the belt to those braces.
 */
export const WRITE_WRAPPER_MARK: unique symbol = Symbol.for("better-intra.config.wrapper");

function isMarkedWrapper(fn: unknown): boolean {
  return (
    typeof fn === "function" &&
    (fn as unknown as Record<symbol, unknown>)[WRITE_WRAPPER_MARK] === true
  );
}

/**
 * Wrap storage.local.set / remove / clear so this context's writes reach the
 * snapshot at once. All or nothing: false (and the originals back in place) if
 * any of the three cannot be replaced.
 */
function installWriteObserver(area: chrome.storage.StorageArea): boolean {
  const target = area as unknown as Record<WriteMethod, AnyFn>;
  const record: Record<WriteMethod, (args: unknown[]) => boolean> = {
    set: (args) => recordSet(args[0], typeof args[1] === "function"),
    remove: (args) => recordRemove(args[0], typeof args[1] === "function"),
    clear: (args) => recordClear(typeof args[0] === "function"),
  };
  const replaced: [WriteMethod, AnyFn][] = [];
  const restore = () => {
    for (const [method, original] of replaced) {
      try {
        target[method] = original;
      } catch {
        /* nothing better to do */
      }
    }
  };

  try {
    // Another copy of this module got here first (see WRITE_WRAPPER_MARK).
    if ((["set", "remove", "clear"] as const).some((m) => isMarkedWrapper(target[m]))) {
      return false;
    }
    for (const method of ["set", "remove", "clear"] as const) {
      const original = target[method];
      if (typeof original !== "function") {
        restore();
        return false;
      }
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        let concernsSnapshot = true;
        try {
          concernsSnapshot = record[method](args);
        } catch {
          resetConfigCache();
        }
        let out: unknown;
        try {
          out = Reflect.apply(original, this, args);
        } catch (error) {
          if (concernsSnapshot) resetConfigCache();
          throw error;
        }
        if (
          concernsSnapshot &&
          out !== null &&
          typeof out === "object" &&
          typeof (out as PromiseLike<unknown>).then === "function"
        ) {
          // Same outcome for the caller (value or error), and an unhandled
          // failure is still reported once, as before.
          return (out as Promise<unknown>).then(undefined, (error: unknown) => {
            resetConfigCache();
            throw error;
          });
        }
        return out;
      };
      Object.defineProperty(wrapper, WRITE_WRAPPER_MARK, { value: true });
      target[method] = wrapper;
      if (target[method] !== wrapper) {
        restore();
        return false;
      }
      replaced.push([method, original]);
    }
  } catch {
    restore();
    return false;
  }
  return true;
}

function onStorageChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
): void {
  if (area !== "local" || !changes) return;
  for (const key of Object.keys(changes)) {
    if (!SNAPSHOT_KEY_SET.has(key)) continue;
    const change = changes[key];
    if (!change || typeof change !== "object") continue;
    // Copied: the other listeners receive the very same objects.
    applyChange(key, "newValue" in change ? copyRaw(change.newValue) : REMOVED);
  }
}

/**
 * Called once, by src/core/config.ts when it is evaluated (see "Ordering"
 * above). A second call does nothing: wrapping the methods twice would record
 * every write twice.
 */
export function initSnapshot(): void {
  if (initialised) return;
  initialised = true;
  try {
    if (typeof chrome === "undefined") return;
    const area = chrome.storage?.local;
    const onChanged = chrome.storage?.onChanged;
    if (!area || typeof onChanged?.addListener !== "function") return;
    if (!installWriteObserver(area)) return;
    cacheEnabled = true;
    onChanged.addListener(onStorageChanged);
    watchPageRestores();
  } catch {
    cacheEnabled = false;
  }
}

/**
 * A page kept in the back/forward cache (or frozen by the browser to save
 * resources) receives no extension events: Firefox ignores listeners of an
 * inactive content-script context and does not replay them, and Chrome does
 * not deliver them to cached pages either. So every change made meanwhile by
 * another tab, the popup or a later page of the same tab is missed, and a
 * write from the restored page (adding a friend reads FRIENDS_LIST, a cloud
 * upload reads every synced key) would put stale values back.
 *
 * The page cannot know what it missed, so it forgets everything and reloads
 * on the next read: one storage round trip per restore.
 */
function watchPageRestores(): void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) resetConfigCache();
  });
  // Page Lifecycle API (Chromium): a frozen page is resumed without pageshow.
  document.addEventListener("resume", () => resetConfigCache());
}
