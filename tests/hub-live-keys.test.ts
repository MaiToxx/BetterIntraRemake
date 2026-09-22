/**
 * The hub tags every setting the page does not apply live with "reload". The
 * tag is only right if isLiveKey() mirrors the storage.onChanged listeners:
 * this case rebuilds the set of live keys from the lists those listeners
 * watch and compares it with what the hub says for every keyed setting.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HUB_SETTING_DEFS, isLiveKey } from "../src/features/hub/hubSettings.data.ts";
import { CUSTOMIZE_KEYS } from "../src/features/customize/customize.ts";
import { EXTRAS_KEYS } from "../src/features/profile/extras/extras.ts";
import { PERF_KEYS } from "../src/features/performance/perf.ts";

/**
 * Each listener and the keys it applies, as its source reads today. Sharing
 * the look is not applied on the page: it is pushed at once (publish.ts), so
 * there is nothing to reload for either.
 */
const LISTENERS: { file: string; keys: readonly string[]; marker?: RegExp }[] = [
  {
    file: "src/features/customize/publish.ts",
    keys: ["CUSTOM_SHARE_LOOK"],
    marker: /publishLookIfShared/,
  },
  {
    file: "src/features/customize/customize.ts",
    keys: [...CUSTOMIZE_KEYS, "DISABLE_ANIMATIONS", "CUSTOM_SHOW_OTHERS_LOOK"],
  },
  {
    file: "src/features/profile/extras/extras-apply.ts",
    keys: [...EXTRAS_KEYS, "PROFILE_SHOW_OTHERS_EXTRAS", "DISABLE_ANIMATIONS"],
  },
  { file: "src/features/performance/perf.ts", keys: PERF_KEYS },
  {
    file: "src/core/theme/theme-manager.ts",
    keys: ["BETTER_INTRA_THEME", "PROFILE_THEME_PRESET"],
  },
  { file: "src/features/campus/campus.ts", keys: ["CLUSTERS_CAMPUS"] },
];

describe("live keys", () => {
  it("every listener the list relies on still exists", () => {
    for (const { file, marker } of LISTENERS) {
      expect(readFileSync(file, "utf8"), file).toMatch(marker ?? /storage\??\.onChanged/);
    }
  });

  it("isLiveKey() says live exactly for the keys a listener applies", () => {
    const live = new Set(LISTENERS.flatMap((l) => l.keys));
    const wrong: string[] = [];
    for (const defs of Object.values(HUB_SETTING_DEFS)) {
      for (const def of defs) {
        if (!def.key) continue;
        if (isLiveKey(def.key) !== live.has(def.key)) wrong.push(def.key);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the feature switches and the Logtime settings need a reload", () => {
    expect(isLiveKey("ACTIVE_SCRIPTS")).toBe(false);
    expect(isLiveKey("LOGTIME_SHOW_AVERAGE")).toBe(false);
    expect(isLiveKey("CUSTOM_HIDE_FOOTER")).toBe(true);
  });
});
