/**
 * What every control of the settings hub shares, kept here once so that no
 * renderer holds its own copy: how the hub writes a setting, and the option
 * lists it fetches when it opens.
 *
 * The lists are not module state: hubSettings.ui.ts loads them once per modal
 * and passes them down to the few controls that read them.
 */
import type { ConfigKey } from "../../../core/config.ts";
import { publishLookIfShared } from "../../customize/publish.ts";
import {
  fetchCampusList,
  fetchEventTypes,
} from "../../clusters/clusters.data.ts";
import { ensureCampusData } from "../../campus/campus.ts";

/**
 * Saves one setting. Every control goes through here so that a change to a
 * public setting (the shared look, the profile extras) also reaches the cloud.
 */
export async function saveSetting(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
  publishLookIfShared(key);
}

/**
 * Removes settings (a tab's Reset). A reset of public settings (the look,
 * the profile extras) must reach the cloud as well.
 */
export async function removeSettings(keys: ConfigKey[]): Promise<void> {
  await chrome.storage.local.remove(keys);
  for (const key of keys) publishLookIfShared(key);
}

/** One entry of a list built at run time. */
export type Choice = { label: string; value: string };

/**
 * Lists the hub cannot know at build time. Each one is empty when its fetch
 * failed, and the controls then fall back to the options of their def.
 */
export type LiveOptions = {
  /** Every campus of the campus manifest (campus select, campus badge). */
  campuses: Choice[];
  /** The event types of the events feed (event visibility filter). */
  eventTypes: Choice[];
};

/**
 * Fetches the live lists, and makes sure the campus data is loaded: the
 * "Default cluster" select reads its clusters when the tabs are drawn.
 */
export async function loadLiveOptions(): Promise<LiveOptions> {
  let campuses: Choice[] = [];
  try {
    const manifest = await fetchCampusList();
    campuses = manifest.campuses.map((c) => ({ label: c.name, value: c.id }));
  } catch {
    campuses = [];
  }
  await ensureCampusData();
  let eventTypes: Choice[] = [];
  try {
    eventTypes = await fetchEventTypes();
  } catch {
    eventTypes = [];
  }
  return { campuses, eventTypes };
}
