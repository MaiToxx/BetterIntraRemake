/**
 * Keep the published look fresh: when the user shares their look and changes
 * a Customize setting, push the settings to the cloud shortly after (one push
 * per burst of changes), whatever the "auto sync" setting says. Without this
 * a visitor could see last week's colours.
 */
import { getConfigMany } from "../../core/config.ts";
import { syncToCloud } from "../account/account.ts";
import { CUSTOMIZE_KEYS } from "./customize.ts";
import { EXTRAS_KEYS } from "../profile/extras/extras.ts";

const SHARE_KEY = "CUSTOM_SHARE_LOOK";
const RELEVANT = new Set<string>([...CUSTOMIZE_KEYS, SHARE_KEY, ...EXTRAS_KEYS]);
/** Keys that are public by nature: published as soon as they change. */
const ALWAYS_PUBLIC = new Set<string>([SHARE_KEY, ...EXTRAS_KEYS]);
let timer: ReturnType<typeof setTimeout> | null = null;
/** A key of ALWAYS_PUBLIC changed during the current burst. */
let forced = false;

export function publishLookIfShared(changedKey: string): void {
  if (!RELEVANT.has(changedKey)) return;
  if (ALWAYS_PUBLIC.has(changedKey)) forced = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    const force = forced;
    forced = false;
    const c = await getConfigMany([SHARE_KEY, "CLOUD_TOKEN"]);
    // Turning sharing off must reach the server too (the flag is synced).
    if (!c.CLOUD_TOKEN) return;
    if (!c.CUSTOM_SHARE_LOOK && !force) return;
    await syncToCloud();
    // public-by-nature keys are pushed sooner: the user often edits their
    // profile and immediately reloads the page
  }, forced ? 600 : 1500);
}
