/**
 * Keep the published look fresh: when the user shares their look and changes
 * a setting of it, send the public settings to the cloud a few seconds later
 * (one push per burst of changes), whatever the "auto sync" setting says.
 * Without this a visitor could see last week's colours.
 *
 * Only the public keys go, never the whole record: a full push of every
 * setting spent one of the day's shared KV writes per burst, and uploaded
 * every setting of a student who chose Manual push.
 */
import { getConfigMany, type ConfigKey } from "../../core/config.ts";
import { getPushFailure, pushPartial } from "../account/account.ts";
import { PUBLIC_LOOK_KEYS } from "./public-look.ts";
import { EXTRAS_KEYS } from "../profile/extras/extras.ts";

const SHARE_KEY: ConfigKey = "CUSTOM_SHARE_LOOK";
/** The changes waiting to be published, key -> when (a local-only setting). */
const PENDING_KEY = "LOOK_PUBLISH_PENDING";
/**
 * The keys that change what visitors see. The rest of Customize (custom CSS,
 * fonts, density, footer, scrollbar) is never published: a push for it spent
 * one of the day's shared KV writes, and uploaded every setting of a student
 * who chose Manual push, for nothing a visitor could see.
 */
const LOOK = new Set<string>([...PUBLIC_LOOK_KEYS, SHARE_KEY]);
const EXTRAS = new Set<string>(EXTRAS_KEYS);

function isPublic(key: string): key is ConfigKey {
  return LOOK.has(key) || EXTRAS.has(key);
}

/**
 * How long a burst of changes waits before it is published. A few seconds,
 * not less: trying ten theme presets in a row used to cost ten KV writes.
 * Not more either: the change is kept in storage meanwhile, and a page left
 * before the end sends it on the next page, but visitors wait that long.
 */
export const LOOK_PUBLISH_DELAY_MS = 4_000;

let timer: ReturnType<typeof setTimeout> | null = null;
/** Every change of the current burst came from the hub. */
let fromHubOnly = true;
/** The pending list is read, changed and written back one change at a time. */
let pendingWrites: Promise<void> = Promise.resolve();

function readPending(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, at] of Object.entries(raw as Record<string, unknown>)) {
    if (isPublic(key) && typeof at === "number") out[key] = at;
  }
  return out;
}

function updatePending(change: (pending: Record<string, number>) => void): Promise<void> {
  pendingWrites = pendingWrites
    .then(async () => {
      const pending = readPending((await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY]);
      change(pending);
      await chrome.storage.local.set({ [PENDING_KEY]: pending });
    })
    .catch(() => {
      /* the in-memory timer still publishes this page's changes */
    });
  return pendingWrites;
}

/**
 * `fromHub`: the change was made in the settings hub (every caller but the
 * one-off default push below). With Auto push on, the hub already pushes
 * every synced change it sees; this one used to push the same change a
 * second time, half a second later.
 */
export function publishLookIfShared(changedKey: string, fromHub = true): void {
  if (!isPublic(changedKey)) return;
  if (!fromHub) fromHubOnly = false;
  const at = Date.now();
  void updatePending((pending) => {
    pending[changedKey] = at;
  });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const hubOnly = fromHubOnly;
    fromHubOnly = true;
    void flushLookPublish({ hubOnly });
  }, LOOK_PUBLISH_DELAY_MS);
}

/**
 * Publishes the pending changes now: at the end of a burst, when the hub
 * closes, and on the next page for a change whose wait died with its page.
 *
 * A change of the look sends the whole look (a preset changes a dozen keys
 * and announces one of them); an extras field sends itself. Nothing while
 * the restore question of a fresh sign-in is open (this browser may still
 * hold defaults), after a lapsed sign-in, or on the day the server's write
 * budget ran out: the changes stay pending for later.
 */
export async function flushLookPublish(options: { hubOnly?: boolean } = {}): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await pendingWrites;
  const startedAt = Date.now();
  const raw = await chrome.storage.local.get([
    PENDING_KEY,
    "CLOUD_AUTH_FAILED",
    "PENDING_SETTINGS_RESTORE",
  ]);
  const pending = Object.keys(readPending(raw[PENDING_KEY])).filter(isPublic);
  if (pending.length === 0) return;
  const c = await getConfigMany([SHARE_KEY, "CLOUD_TOKEN", "CLOUD_SYNC_ENABLED"]);
  if (!c.CLOUD_TOKEN || raw.CLOUD_AUTH_FAILED || raw.PENDING_SETTINGS_RESTORE) return;
  const done = () =>
    updatePending((now) => {
      for (const key of pending) if ((now[key] ?? 0) < startedAt) delete now[key];
    });
  // Auto push: the hub pushes every synced change itself, these included.
  if (options.hubOnly && c.CLOUD_SYNC_ENABLED) return done();
  // (only today's: getPushFailure forgets it at 00:00 UTC)
  if ((await getPushFailure())?.reason === "daily-limit") return;

  const keys = new Set<ConfigKey>(pending.filter((k) => EXTRAS.has(k)));
  if (c.CUSTOM_SHARE_LOOK && pending.some((k) => LOOK.has(k))) {
    for (const key of LOOK) keys.add(key as ConfigKey);
  } else if (pending.includes(SHARE_KEY)) {
    // turning sharing off must reach the server too (the flag is synced);
    // the look itself is not published while it is not shared
    keys.add(SHARE_KEY);
  }
  if (keys.size === 0) return done();
  const result = await pushPartial(await getConfigMany([...keys]));
  // Kept for a retry on a failure that can pass (no answer, the rate limit,
  // a busy KV, the daily budget tomorrow); a value too large stays too large.
  if (result === "ok" || result === "too-large") await done();
}

const DEFAULT_PUSHED = "LOOK_DEFAULT_PUBLISHED";

/**
 * Runs on every page: the one-off default below, then what an earlier page
 * left pending (a reload or a link within the publish delay).
 *
 * 1.14.0 turned "Publish my look" on by default. The worker publishes what
 * the last push said, and every push before carried the old default (false):
 * accounts that never chose push once, so that their look and theme show up
 * without waiting for their next settings change. A choice the user made
 * (the key is in storage) is left alone.
 *
 * Only for a browser that pushed before (LAST_CLOUD_SYNC), and never while
 * the restore question of a fresh sign-in is open: on a new install the
 * first sign-in reloaded the tab and this pushed every synced key at its
 * default 600 ms later, over the cloud backup (friends, shortcuts, custom
 * CSS, visuals), before "Restore your settings?" was even asked. A new
 * install has no old default to replace: its first push carries the new one.
 */
export async function publishDefaultLookOnce(): Promise<void> {
  const raw = await chrome.storage.local.get([
    SHARE_KEY,
    DEFAULT_PUSHED,
    "CLOUD_TOKEN",
    "LAST_CLOUD_SYNC",
    "PENDING_SETTINGS_RESTORE",
  ]);
  if (!raw.CLOUD_TOKEN) return;
  if (!raw[DEFAULT_PUSHED]) {
    await chrome.storage.local.set({ [DEFAULT_PUSHED]: true });
    // a stored value, not the key: some storages list missing keys as undefined
    if (
      raw.LAST_CLOUD_SYNC &&
      !raw.PENDING_SETTINGS_RESTORE &&
      typeof raw[SHARE_KEY] !== "boolean"
    ) {
      publishLookIfShared(SHARE_KEY, false);
      return;
    }
  }
  await flushLookPublish();
}
