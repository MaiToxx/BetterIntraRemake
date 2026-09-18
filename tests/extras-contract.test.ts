/**
 * The published-keys contract, pinned.
 *
 * EXTRAS_KEYS is copied by hand in the worker
 * (better-intra-worker/src/handlers/settings.ts, PUBLIC_EXTRAS_KEYS): the
 * worker cannot import from the extension. Nothing else ties the two lists
 * together, so both repositories pin the list in a test. Editing EXTRAS_KEYS
 * fails this test; the fix is to update the worker's copy, redeploy it
 * (npm run deploy there), and paste the new list below. A key the worker
 * does not know is never published, so a visitor would never see it.
 */
import { describe, it, expect } from "vitest";
import { EXTRAS_KEYS } from "../src/features/profile/extras/extras";
import { CONFIG_DEFAULT } from "../src/config";

/** Mirror of PUBLIC_EXTRAS_KEYS in better-intra-worker/src/handlers/settings.ts. */
const PUBLISHED_BY_THE_WORKER = [
  "PROFILE_PUB_ENABLED",
  "PROFILE_PUB_BIO",
  "PROFILE_PUB_STATUS_EMOJI",
  "PROFILE_PUB_STATUS_TEXT",
  "PROFILE_PUB_PRONOUNS",
  "PROFILE_PUB_FLAIR",
  "PROFILE_PUB_GREETING",
  "PROFILE_PUB_LINK_GITHUB",
  "PROFILE_PUB_LINK_GITLAB",
  "PROFILE_PUB_LINK_LINKEDIN",
  "PROFILE_PUB_LINK_WEBSITE",
  "PROFILE_PUB_LINK_DISCORD",
  "PROFILE_PUB_NAME_STYLE",
  "PROFILE_PUB_NAME_COLOR",
  "PROFILE_PUB_NAME_COLOR_2",
  "PROFILE_PUB_NAME_FONT",
  "PROFILE_PUB_FRAME",
  "PROFILE_PUB_FRAME_COLOR",
  "PROFILE_PUB_FRAME_COLOR_2",
  "PROFILE_PUB_LEVEL_STYLE",
  "PROFILE_PUB_LEVEL_COLOR",
  "PROFILE_PUB_LEVEL_COLOR_2",
  "PROFILE_PUB_BANNER_GRADIENT",
  "PROFILE_PUB_BANNER_DIM",
  "PROFILE_PUB_BANNER_BLUR",
  "PROFILE_PUB_CARD_GLOW",
  "PROFILE_PUB_EFFECT",
  "PROFILE_PUB_EFFECT_INTENSITY",
  "PROFILE_PUB_EFFECT_TINT",
  "PROFILE_PUB_EFFECT_COLOR",
] as const;

describe("published keys", () => {
  it("match the list the worker publishes", () => {
    expect([...EXTRAS_KEYS]).toEqual([...PUBLISHED_BY_THE_WORKER]);
  });

  it("are declared settings, unique, and none of them is a secret", () => {
    expect(new Set(EXTRAS_KEYS).size).toBe(EXTRAS_KEYS.length);
    for (const key of EXTRAS_KEYS) {
      expect(key).toMatch(/^PROFILE_PUB_[A-Z0-9_]+$/);
      expect(CONFIG_DEFAULT).toHaveProperty(key);
    }
    // the viewer-side switch is a local preference, never published
    expect([...EXTRAS_KEYS]).not.toContain("PROFILE_SHOW_OTHERS_EXTRAS");
  });
});
