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
import { ensureCampusData, loadCampusData } from "../../campus/campus.ts";
import { getConfig } from "../../../core/config.ts";

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

/**
 * The ids setting.ts gives the label and the description of a setting's card,
 * for its controls to point at with aria-labelledby / aria-describedby: the
 * label is a <span> beside the control, not a <label> around it, so nothing
 * else ties the two together for a screen reader. The whole hub is one shadow
 * root, where the references resolve. Keyed by the def (one object per
 * setting, rendered once per hub), so every renderer gets the same ids
 * without passing them down; a def without a key gets a counter.
 */
export type SettingIds = {
  label: string;
  /** Only when the def has a description, so nothing points at nothing. */
  desc?: string;
  /** The "Not recognised" hint of a public profile link field. */
  hint: string;
};

const settingIdCache = new WeakMap<object, SettingIds>();
let settingIdSeq = 0;

export function settingIds(def: {
  key?: string;
  desc?: string;
}): SettingIds {
  let ids = settingIdCache.get(def);
  if (!ids) {
    const base = `hub-${def.key ?? `s${++settingIdSeq}`}`;
    ids = {
      label: `${base}-label`,
      desc: def.desc ? `${base}-desc` : undefined,
      hint: `${base}-hint`,
    };
    settingIdCache.set(def, ids);
  }
  return ids;
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
  /**
   * The campus file declares chair positions (`definitions`): the markers
   * switch is drawn only then. Unknown counts as no.
   */
  chairMarkers?: boolean;
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
  return { campuses, eventTypes, chairMarkers: await campusHasChairMarkers() };
}

/** Whether the user's campus file declares chair positions (served from cache). */
async function campusHasChairMarkers(): Promise<boolean> {
  try {
    const campusId = await getConfig("CLUSTERS_CAMPUS");
    if (!campusId) return false;
    const data = await loadCampusData(campusId);
    return Object.keys(data.definitions ?? {}).length > 0;
  } catch {
    return false;
  }
}
