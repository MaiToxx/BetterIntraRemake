/**
 * What a hub change pushes on its own, whatever "Manual push" says: only a
 * setting a visitor can see (the published look, the profile extras, the
 * sharing switch). A custom CSS, font, density, footer or scrollbar edit
 * used to push every setting to the cloud 1.5 s later, and spend one of the
 * day's shared KV writes, for nothing that is ever published.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUBLIC_LOOK_KEYS } from "../src/features/customize/public-look.ts";
import { CUSTOMIZE_KEYS } from "../src/features/customize/customize.ts";
import { EXTRAS_KEYS } from "../src/features/profile/extras/extras.ts";

const sync = vi.fn(async () => true);

beforeEach(async () => {
  vi.resetModules();
  sync.mockClear();
  vi.doMock("../src/features/account/account.ts", () => ({ syncToCloud: sync }));
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CUSTOM_SHARE_LOOK: true });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("../src/features/account/account.ts");
});

/** Pushes after a change to `key`, once its burst is over. */
async function pushesFor(key: string): Promise<number> {
  const { publishLookIfShared } = await import("../src/features/customize/publish.ts");
  sync.mockClear();
  publishLookIfShared(key);
  await vi.advanceTimersByTimeAsync(2_000);
  return sync.mock.calls.length;
}

describe("the look's own pushes", () => {
  it("never push for a Customize setting that is not published", async () => {
    const privateKeys = CUSTOMIZE_KEYS.filter(
      (k) => !(PUBLIC_LOOK_KEYS as readonly string[]).includes(k),
    );
    expect(privateKeys).toEqual(
      expect.arrayContaining(["CUSTOM_CSS", "CUSTOM_FONT", "CUSTOM_DENSITY", "CUSTOM_SCROLLBAR"]),
    );
    for (const key of privateKeys) expect(await pushesFor(key), key).toBe(0);
  });

  it("still push for the published look, the profile extras and the switch", async () => {
    for (const key of ["CUSTOM_ACCENT_COLOR", "PROFILE_THEME_PRESET", "CUSTOM_CARDS"]) {
      expect(await pushesFor(key), key).toBe(1);
    }
    expect(await pushesFor(EXTRAS_KEYS[0])).toBe(1);
    expect(await pushesFor("CUSTOM_SHARE_LOOK")).toBe(1);
  });

  it("push extras even with sharing off, and nothing else", async () => {
    await chrome.storage.local.set({ CUSTOM_SHARE_LOOK: false });
    expect(await pushesFor("CUSTOM_ACCENT_COLOR")).toBe(0);
    expect(await pushesFor("PROFILE_PUB_BIO")).toBe(1);
  });
});
