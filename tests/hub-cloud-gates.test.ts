/**
 * The hub greys out a requiresCloud setting while signed out. The flag must
 * match what actually needs the cloud, otherwise a signed-out student cannot
 * turn off a feature that runs anyway.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

async function loadDefs(authMode: "oauth" | "intra") {
  vi.resetModules();
  vi.doMock("../src/core/worker.ts", () => ({
    WORKER_URL: "https://api.betterintra.com",
    AUTH_MODE: authMode,
  }));
  const { EXTRAS_SETTINGS } = await import("../src/features/hub/settings/extras.ts");
  const { PROFILE_SETTINGS } = await import("../src/features/hub/settings/profile.ts");
  const cards = EXTRAS_SETTINGS.flatMap((d) => d.options ?? []);
  const option = (value: string) => cards.find((o) => o.value === value)!;
  const setting = (key: string) => PROFILE_SETTINGS.find((d) => d.key === key)!;
  return { option, setting };
}

afterEach(() => {
  vi.doUnmock("../src/core/worker.ts");
});

describe("hub cloud gates", () => {
  it("the marks list and its sort order run without a cloud session, in both modes", async () => {
    for (const mode of ["oauth", "intra"] as const) {
      const { setting } = await loadDefs(mode);
      expect(setting("PROFILE_SHOW_MARKS").requiresCloud, mode).toBeFalsy();
      expect(setting("PROFILE_MARKS_SORT_ORDER").requiresCloud, mode).toBeFalsy();
    }
  });

  it("oauth: the roulette card comes from the worker and needs the sign-in", async () => {
    const { option } = await loadDefs("oauth");
    expect(option("PROFILE_SHOW_ROULETTE").requiresCloud).toBe(true);
    expect(option("PROFILE_SHOW_ROULETTE").subToggle?.requiresCloud).toBe(true);
  });

  it("intra mode: the roulette card reads the Intra pages and does not", async () => {
    const { option } = await loadDefs("intra");
    expect(option("PROFILE_SHOW_ROULETTE").requiresCloud).toBeFalsy();
    expect(option("PROFILE_SHOW_ROULETTE").subToggle?.requiresCloud).toBeFalsy();
    // sharing subject links still goes through the worker
    expect(option("SUBJECT_TRACKER_ENABLED").subToggle?.requiresCloud).toBe(true);
  });
});
