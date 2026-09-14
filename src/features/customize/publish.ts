/**
 * Keep the published look fresh: when the user shares their look and changes
 * a Customize setting, push the settings to the cloud shortly after (one push
 * per burst of changes), whatever the "auto sync" setting says. Without this
 * a visitor could see last week's colours.
 */
import { getConfigMany } from "../../config.ts";
import { syncToCloud } from "../account/account.ts";
import { CUSTOMIZE_KEYS } from "./customize.ts";

const SHARE_KEY = "CUSTOM_SHARE_LOOK";
const RELEVANT = new Set<string>([...CUSTOMIZE_KEYS, SHARE_KEY]);
let timer: ReturnType<typeof setTimeout> | null = null;

export function publishLookIfShared(changedKey: string): void {
  if (!RELEVANT.has(changedKey)) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    const c = await getConfigMany([SHARE_KEY, "CLOUD_TOKEN"]);
    // Turning sharing off must reach the server too (the flag is synced).
    if (!c.CLOUD_TOKEN) return;
    if (!c.CUSTOM_SHARE_LOOK && changedKey !== SHARE_KEY) return;
    await syncToCloud();
  }, 1500);
}
