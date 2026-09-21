/**
 * Clusters tab of the settings hub: direction markers, how profiles open from
 * the map, and the cluster a page starts on.
 */
import { CONFIG_DEFAULT } from "../../../core/config.ts";
import { CLUSTERS as CLUSTER_OPTIONS } from "../../clusters/clusters.data.ts";
import type { HubSettingDef } from "../hubSettings.data.ts";

export const CLUSTERS_SETTINGS: readonly HubSettingDef[] = [
  {
    feature: "clusters",
    key: "CLUSTERS_SHOW_MARKERS",
    label: "Show markers",
    desc: "Shows the direction markers on the cluster screen.",
    kind: "toggle",
    defaultValue: CONFIG_DEFAULT.CLUSTERS_SHOW_MARKERS,
    grid: true,
    colSpan: 1,
  },
  {
    feature: "clusters",
    key: "CLUSTERS_OPEN_NEW_TAB",
    label: "Open profiles in new tab",
    desc: "When clicking a user on the clusters map, opens their profile in a new tab.",
    kind: "toggle",
    defaultValue: CONFIG_DEFAULT.CLUSTERS_OPEN_NEW_TAB,
    grid: true,
    colSpan: 1,
  },
  {
    feature: "clusters",
    key: "CLUSTERS_DEFAULT_ID",
    label: "Default cluster",
    desc: "Prefills a cluster page when the page opens.",
    kind: "select",
    defaultValue: String(CONFIG_DEFAULT.CLUSTERS_DEFAULT_ID),
    options: CLUSTER_OPTIONS.map((c) => ({
      label: c.name.toUpperCase(),
      value: c.id,
    })),
    grid: true,
    colSpan: 1,
  },
];
