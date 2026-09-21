/**
 * When a setting of the hub can be used. A setting may depend on another one
 * (dependsOn, narrowed by dependsOnValues for a select parent) or on the cloud
 * account (requiresCloud).
 *
 * This module decides which settings start disabled or hidden when the hub
 * opens, then keeps the dependants in step with their parent control. Both
 * halves live together because they must agree on what "on" means: if they
 * did not, a dependant would show at open and vanish on the first change.
 */
import { getConfig, CONFIG_DEFAULT } from "../../core/config.ts";
import { HUB_SETTING_DEFS, type HubSettingDef } from "./hubSettings.data.ts";

/** Stands in the disabled set for every requiresCloud setting when offline. */
export const CLOUD_GATE = "__CLOUD__";

export type SettingGates = {
  /** Keys drawn disabled, plus CLOUD_GATE when no cloud account is connected. */
  disabled: Set<string>;
  /** Keys drawn hidden: their parent is off. */
  hidden: Set<string>;
};

/** Reads the stored parents and the cloud token: the state at open. */
export async function initialGates(): Promise<SettingGates> {
  const depParentKeys = new Set<string>();
  for (const defs of Object.values(HUB_SETTING_DEFS)) {
    for (const def of defs) {
      if (def.dependsOn) depParentKeys.add(def.dependsOn);
    }
  }
  const depValues = await chrome.storage.local.get([...depParentKeys]);
  const disabledDeps = new Set<string>();
  const hiddenDeps = new Set<string>();
  for (const defs of Object.values(HUB_SETTING_DEFS)) {
    for (const def of defs) {
      if (def.dependsOn && def.key) {
        const parentVal =
          depValues[def.dependsOn] ?? CONFIG_DEFAULT[def.dependsOn];
        // A select parent stores a string even when it is off: "none" and
        // "default" count as off here exactly as in parentIsOn(), otherwise
        // its dependants show at open and vanish on the first change.
        const off = def.dependsOnValues
          ? !def.dependsOnValues.includes(String(parentVal))
          : !parentVal || parentVal === "none" || parentVal === "default";
        if (off) {
          disabledDeps.add(def.key);
          hiddenDeps.add(def.key);
        }
      }
    }
  }
  const cloudToken = await getConfig("CLOUD_TOKEN");
  if (!cloudToken) {
    disabledDeps.add(CLOUD_GATE);
    for (const defs of Object.values(HUB_SETTING_DEFS)) {
      for (const def of defs) {
        if (def.requiresCloud && def.key) disabledDeps.add(def.key);
      }
    }
  }
  return { disabled: disabledDeps, hidden: hiddenDeps };
}

/** Re-evaluates the dependants whenever a control of the hub changes. */
export function bindDependents(shadow: ShadowRoot): void {
  shadow.addEventListener("change", (e) => {
    const parentKey = (e.target as HTMLElement).dataset.settingKey;
    if (parentKey) refreshDependents(shadow, parentKey);
  });
  // Presets, theme codes and Reset rewrite many controls at once without
  // firing "change": they announce it and every dependency is re-evaluated.
  shadow.addEventListener("bi-settings-synced", () => refreshDependents(shadow));
}

/** Whether a parent control currently enables its dependants. */
function parentIsOn(el: HTMLElement, def?: HubSettingDef): boolean {
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return el.checked;
    return el.value.trim() !== "";
  }
  if (el instanceof HTMLSelectElement) {
    // a def can name the exact parent values it is useful for
    if (def?.dependsOnValues) return def.dependsOnValues.includes(el.value);
    return el.value !== "" && el.value !== "none" && el.value !== "default";
  }
  return true;
}

/**
 * Show/enable the controls that depend on `parentKey` (every parent when
 * omitted) according to the parent control's current state.
 */
function refreshDependents(root: ParentNode, parentKey?: string): void {
  for (const defs of Object.values(HUB_SETTING_DEFS)) {
    for (const def of defs) {
      if (!def.dependsOn || !def.key) continue;
      if (parentKey && def.dependsOn !== parentKey) continue;
      const parent = root.querySelector<HTMLElement>(
        `[data-setting-key="${def.dependsOn}"]`,
      );
      if (!parent) continue;
      const on = parentIsOn(parent, def);
      const el = root.querySelector<HTMLElement>(
        `[data-setting-key="${def.key}"]`,
      );
      if (!el) continue;
      const card = el.closest<HTMLElement>(".card");
      if (card) {
        card.classList.toggle("hidden", !on);
        card.classList.toggle("opacity-40", !on);
        card.classList.toggle("grayscale", !on);
      }
      (el as HTMLInputElement).disabled = !on;
    }
  }
}
