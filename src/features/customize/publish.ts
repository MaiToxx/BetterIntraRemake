/**
 * Keep the published look fresh: when the user shares their look and changes
 * a setting of it, push the settings to the cloud shortly after (one push
 * per burst of changes), whatever the "auto sync" setting says. Without this
 * a visitor could see last week's colours.
 */
import { getConfigMany } from "../../core/config.ts";
import { syncToCloud } from "../account/account.ts";
import { PUBLIC_LOOK_KEYS } from "./public-look.ts";
import { EXTRAS_KEYS } from "../profile/extras/extras.ts";

const SHARE_KEY = "CUSTOM_SHARE_LOOK";
/**
 * The keys that change what visitors see. The rest of Customize (custom CSS,
 * fonts, density, footer, scrollbar) is never published: a push for it spent
 * one of the day's shared KV writes, and uploaded every setting of a student
 * who chose Manual push, for nothing a visitor could see.
 */
const RELEVANT = new Set<string>([...PUBLIC_LOOK_KEYS, SHARE_KEY, ...EXTRAS_KEYS]);
/** Keys that are public by nature: published as soon as they change. */
const ALWAYS_PUBLIC = new Set<string>([SHARE_KEY, ...EXTRAS_KEYS]);
let timer: ReturnType<typeof setTimeout> | null = null;
/** A key of ALWAYS_PUBLIC changed during the current burst. */
let forced = false;
/** Every change of the current burst came from the hub. */
let fromHubOnly = true;

/**
 * `fromHub`: the change was made in the settings hub (every caller but the
 * one-off default push below). With Auto push on, the hub already pushes
 * every synced change it sees; this one used to push the same change a
 * second time, half a second later.
 */
export function publishLookIfShared(changedKey: string, fromHub = true): void {
  if (!RELEVANT.has(changedKey)) return;
  if (!fromHub) fromHubOnly = false;
  if (ALWAYS_PUBLIC.has(changedKey)) forced = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    const force = forced;
    forced = false;
    const hubOnly = fromHubOnly;
    fromHubOnly = true;
    const c = await getConfigMany([SHARE_KEY, "CLOUD_TOKEN", "CLOUD_SYNC_ENABLED"]);
    // Turning sharing off must reach the server too (the flag is synced).
    if (!c.CLOUD_TOKEN) return;
    if (hubOnly && c.CLOUD_SYNC_ENABLED) return;
    if (!c.CUSTOM_SHARE_LOOK && !force) return;
    await syncToCloud();
    // public-by-nature keys are pushed sooner: the user often edits their
    // profile and immediately reloads the page
  }, forced ? 600 : 1500);
}

const DEFAULT_PUSHED = "LOOK_DEFAULT_PUBLISHED";

/**
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
  if (raw[DEFAULT_PUSHED] || !raw.CLOUD_TOKEN) return;
  await chrome.storage.local.set({ [DEFAULT_PUSHED]: true });
  if (!raw.LAST_CLOUD_SYNC || raw.PENDING_SETTINGS_RESTORE) return;
  // a stored value, not the key: some storages list missing keys as undefined
  if (typeof raw[SHARE_KEY] === "boolean") return;
  publishLookIfShared(SHARE_KEY, false);
}
