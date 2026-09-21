/**
 * Option lists that more than one tab of the hub offers, so that two selects
 * meant to offer the same choices read one list and cannot drift apart.
 *
 * They sit here rather than in hubSettings.data.ts because the tab modules
 * need them as values while they are being built, and hubSettings.data.ts
 * imports the tab modules: importing back from it would be a cycle.
 */
import type { FeatureCardOption } from "../hubSettings.data.ts";

/**
 * Built-in gradients (keys of BG_PRESETS in customize.ts). One list for the
 * page background of the Customize tab and for the public profile header, so
 * that the two selects can never offer different names.
 */
export const BG_PRESET_OPTIONS: readonly FeatureCardOption[] = [
  { label: "None", value: "none" },
  { label: "Aurora", value: "aurora" },
  { label: "Sunset", value: "sunset" },
  { label: "Ocean", value: "ocean" },
  { label: "Forest", value: "forest" },
  { label: "Monochrome", value: "mono" },
  { label: "Midnight", value: "midnight" },
  { label: "Candy", value: "candy" },
  { label: "Lava", value: "lava" },
  { label: "Nord", value: "nord" },
  { label: "Dracula", value: "dracula" },
  { label: "42 teal", value: "teal" },
  { label: "Space", value: "space" },
  { label: "Mesh", value: "mesh" },
];
