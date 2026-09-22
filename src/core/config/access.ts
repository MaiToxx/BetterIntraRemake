/**
 * The typed way to read and write settings: getConfig(), getConfigMany() and
 * setConfig(), plus normalizeConfigValue(), the one place where a raw stored
 * value becomes a typed setting (default, legacy JSON strings, card-order
 * fix-up).
 *
 * Reads are served by the settings snapshot when it is on (snapshot.ts) and
 * go straight to chrome.storage.local otherwise; both paths normalise the same
 * way. Import these from src/core/config.ts, which is also what switches the
 * snapshot on.
 */
import type { BetterIntraConfig, ConfigKey } from "./schema.ts";
import { CONFIG_DEFAULT } from "./defaults.ts";
import { copyRaw, snapshotFor } from "./snapshot.ts";

/**
 * Asynchronously retrieves a configuration value from storage.
 *
 * This generic function is the primary way to access configuration throughout the extension.
 * It returns the stored value for `key` (from the settings snapshot, or
 * straight from `chrome.storage.local` when there is none). If the value is not
 * found in storage, it returns the corresponding default value from the
 * `CONFIG_DEFAULT` object.
 *
 * It also includes a helpful feature to automatically parse stringified JSON
 * for values that are objects or arrays.
 *
 * @param key The configuration key to retrieve.
 * @returns A promise that resolves to the value of the requested configuration key,
 *          with the correct type inferred from the BetterIntraConfig interface.
 */
export const getConfig = async <T extends ConfigKey>(
  key: T,
): Promise<BetterIntraConfig[T]> => {
  let snap = snapshotFor([key]);
  if (snap instanceof Promise) snap = await snap;
  if (snap) return normalizeConfigValue(key, copyRaw(snap.get(key)));
  const res = await chrome.storage.local.get(key);
  return normalizeConfigValue(key, res ? res[key] : undefined);
};

/**
 * Batched variant of getConfig(): one storage round-trip for several keys.
 * Prefer it when a feature needs many settings at once; awaiting getConfig()
 * fifteen times in a row used to add fifteen serial IPC calls on start-up.
 * With the snapshot both cost nothing once it is loaded; this one still saves
 * the round-trips where there is no snapshot.
 */
export const getConfigMany = async <K extends ConfigKey>(
  keys: readonly K[],
): Promise<Pick<BetterIntraConfig, K>> => {
  let snap = snapshotFor(keys);
  if (snap instanceof Promise) snap = await snap;
  const res: Record<string, unknown> | undefined = snap
    ? undefined
    : await chrome.storage.local.get([...keys]);
  const out = {} as Pick<BetterIntraConfig, K>;
  for (const key of keys) {
    out[key] = snap
      ? normalizeConfigValue(key, copyRaw(snap.get(key)))
      : normalizeConfigValue(key, res ? res[key] : undefined);
  }
  return out;
};

/**
 * Typed write for new call sites: `await setConfig({ LOGTIME_GOAL_HOURS: 150 })`.
 * It is chrome.storage.local.set() and nothing else: the snapshot sees it
 * through the same wrapper as the raw set() calls, so both stay interchangeable.
 */
export const setConfig = async (
  values: Partial<BetterIntraConfig>,
): Promise<void> => {
  await chrome.storage.local.set(values);
};

/** Apply defaults, legacy JSON-string parsing and per-key fix-ups to a raw stored value. */
function normalizeConfigValue<T extends ConfigKey>(
  key: T,
  raw: unknown,
): BetterIntraConfig[T] {
  let value: unknown = raw !== undefined ? raw : CONFIG_DEFAULT[key];

  // Some legacy callers serialize arrays/objects as JSON strings (e.g. hub settings).
  // Parse those back so consumers get the declared type. Only for keys that
  // hold an array or an object: a plain string setting (a bio reading
  // "[insert bio]", a custom CSS block) must survive untouched.
  const wantsStructure =
    CONFIG_DEFAULT[key] === null || typeof CONFIG_DEFAULT[key] === "object";
  if (
    wantsStructure &&
    typeof value === "string" &&
    (value.startsWith("[") || value.startsWith("{"))
  ) {
    try {
      value = JSON.parse(value);
    } catch {
      /* keep string */
    }
  }

  if (key === "PROFILE_CARD_ORDER" && Array.isArray(value)) {
    // A backup or a cloud copy can hold non-string items; the fix-up below
    // calls .replace() on each one, and every read of the key used to throw
    // until "Reset all data". Names with a leading "-" (hidden cards) stay.
    let stored = (value as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
    if (stored.length === 0) stored = [...CONFIG_DEFAULT.PROFILE_CARD_ORDER];
    value = stored;
    const defaults = CONFIG_DEFAULT.PROFILE_CARD_ORDER;
    const storedSet = new Set(
      stored.map((s) => s.replace(/^-/, "").toUpperCase()),
    );
    for (const def of defaults) {
      if (!storedSet.has(def.toUpperCase())) {
        stored.push(def);
      }
    }
  }

  return value as BetterIntraConfig[T];
}

/**
 * Whether a raw value has the structure CONFIG_DEFAULT gives its key: the
 * check a backup file and a cloud copy go through before they are written to
 * storage. Only the shape, derived from the default: the hub's enum and range
 * rules live with its defs (features/hub/backup.ts). Unknown keys are refused.
 */
export function isValidStoredValue(key: string, value: unknown): boolean {
  if (!(key in CONFIG_DEFAULT)) return false;
  const reference: unknown = CONFIG_DEFAULT[key as ConfigKey];
  if (reference === null) {
    // nullable keys hold null or an object (a cache, the account)
    return value === null || (typeof value === "object" && !Array.isArray(value));
  }
  if (Array.isArray(reference)) {
    if (!Array.isArray(value)) return false;
    if (key === "SHORTCUTS_LINKS") {
      return value.every(
        (item) =>
          !!item &&
          typeof item === "object" &&
          typeof (item as { name?: unknown }).name === "string" &&
          typeof (item as { url?: unknown }).url === "string",
      );
    }
    // every other list is a list of strings (card order, friends, histories)
    return value.every((item) => typeof item === "string");
  }
  if (typeof reference === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (typeof reference === "object") {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  return typeof value === typeof reference;
}
