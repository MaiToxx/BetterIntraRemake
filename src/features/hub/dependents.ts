/**
 * When a setting of the hub can be used. A setting may depend on another one
 * (dependsOn, narrowed by dependsOnValues for a select parent) or on the cloud
 * account (requiresCloud).
 *
 * This module decides which settings start disabled or hidden when the hub
 * opens, then keeps the dependants in step with their parent control. Both
 * halves live together because they must agree on what "on" means: if they
 * did not, a dependant would show at open and vanish on the first change.
 *
 * "On" is transitive: a setting whose parent is on but whose grandparent is
 * off (two-colour accent still ticked while the accent itself is off) is off.
 * Without that, "Second colour" stayed as an orphan card under a hidden
 * "Two-colour accent".
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

/** Every keyed def, by key, built once: the chain walk looks parents up. */
const DEFS_BY_KEY: ReadonlyMap<string, HubSettingDef> = (() => {
  const map = new Map<string, HubSettingDef>();
  for (const defs of Object.values(HUB_SETTING_DEFS)) {
    for (const def of defs) if (def.key && !map.has(def.key)) map.set(def.key, def);
  }
  return map;
})();

/**
 * Whether a stored parent value turns `def` on. A select parent stores a
 * string even when it is off: "none" and "default" count as off here exactly
 * as in parentIsOn(), otherwise its dependants show at open and vanish on
 * the first change.
 */
function valueTurnsOn(def: HubSettingDef, parentVal: unknown): boolean {
  if (def.dependsOnValues) return def.dependsOnValues.includes(String(parentVal));
  return !!parentVal && parentVal !== "none" && parentVal !== "default";
}

/**
 * Whether `def` is on, following its dependsOn chain to the top. `parentOn`
 * says whether one parent turns its direct child on; `memo` keeps each key's
 * answer for the current pass, and a cycle in the defs counts as off.
 */
function chainIsOn(
  def: HubSettingDef,
  parentOn: (def: HubSettingDef) => boolean | undefined,
  memo: Map<string, boolean>,
): boolean {
  if (!def.dependsOn) return true;
  const memoKey = def.key ?? "";
  const known = memo.get(memoKey);
  if (known !== undefined) return known;
  memo.set(memoKey, false);
  const direct = parentOn(def);
  // an unknown parent (no control on this hub) gates nothing
  if (direct === undefined) {
    memo.set(memoKey, true);
    return true;
  }
  const parentDef = DEFS_BY_KEY.get(def.dependsOn);
  const on = direct && (!parentDef || chainIsOn(parentDef, parentOn, memo));
  memo.set(memoKey, on);
  return on;
}

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
  const memo = new Map<string, boolean>();
  const parentOn = (def: HubSettingDef) =>
    valueTurnsOn(def, depValues[def.dependsOn!] ?? CONFIG_DEFAULT[def.dependsOn!]);
  for (const defs of Object.values(HUB_SETTING_DEFS)) {
    for (const def of defs) {
      if (def.dependsOn && def.key && !chainIsOn(def, parentOn, memo)) {
        disabledDeps.add(def.key);
        hiddenDeps.add(def.key);
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
    // Every dependant, not only the direct children: the grandchildren of
    // the changed control follow it too (97 keyed defs, cheap).
    if ((e.target as HTMLElement).dataset.settingKey) refreshDependents(shadow);
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
 * Show/enable every control that depends on another one, according to the
 * current state of its parent control and of the parents above it.
 */
export function refreshDependents(root: ParentNode): void {
  const memo = new Map<string, boolean>();
  const parentOn = (def: HubSettingDef) => {
    const parent = root.querySelector<HTMLElement>(
      `[data-setting-key="${def.dependsOn}"]`,
    );
    return parent ? parentIsOn(parent, def) : undefined;
  };
  for (const defs of Object.values(HUB_SETTING_DEFS)) {
    for (const def of defs) {
      if (!def.dependsOn || !def.key) continue;
      if (parentOn(def) === undefined) continue;
      const on = chainIsOn(def, parentOn, memo);
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
