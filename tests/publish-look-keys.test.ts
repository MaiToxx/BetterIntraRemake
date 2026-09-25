/**
 * What a hub change pushes on its own, whatever "Manual push" says: only a
 * setting a visitor can see (the published look, the profile extras, the
 * sharing switch), and only those keys. A custom CSS, font, density, footer
 * or scrollbar edit used to push every setting to the cloud 1.5 s later, and
 * a look change the whole record: one of the day's shared KV writes each.
 * The change waits a few seconds (one push per burst) in storage, so that a
 * page left meanwhile does not lose it: the next page sends it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUBLIC_LOOK_KEYS } from "../src/features/customize/public-look.ts";
import { CUSTOMIZE_KEYS } from "../src/features/customize/customize.ts";
import { EXTRAS_KEYS } from "../src/features/profile/extras/extras.ts";

const account = vi.hoisted(() => ({
  pushPartial: vi.fn(async (_settings: Record<string, unknown>): Promise<string> => "ok"),
  getPushFailure: vi.fn(async (): Promise<{ reason: string; at: number } | null> => null),
}));

let DELAY = 4_000;

beforeEach(async () => {
  vi.resetModules();
  account.pushPartial.mockReset();
  account.pushPartial.mockImplementation(async () => "ok");
  account.getPushFailure.mockReset();
  account.getPushFailure.mockImplementation(async () => null);
  vi.doMock("../src/features/account/account.ts", () => account);
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CUSTOM_SHARE_LOOK: true });
  vi.useFakeTimers();
  ({ LOOK_PUBLISH_DELAY_MS: DELAY } = await import("../src/features/customize/publish.ts"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("../src/features/account/account.ts");
});

const publish = () => import("../src/features/customize/publish.ts");
const pending = async () =>
  ((await chrome.storage.local.get("LOOK_PUBLISH_PENDING")).LOOK_PUBLISH_PENDING ?? {}) as Record<
    string,
    number
  >;
/** The keys of the n-th push. */
const sent = (n = 0) => Object.keys(account.pushPartial.mock.calls[n][0]).sort();

/** Pushes after a change to `key`, once its burst is over. */
async function pushesFor(key: string): Promise<number> {
  const { publishLookIfShared } = await publish();
  account.pushPartial.mockClear();
  publishLookIfShared(key);
  await vi.advanceTimersByTimeAsync(DELAY + 100);
  return account.pushPartial.mock.calls.length;
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
    expect(await pending()).toEqual({});
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
    expect(sent()).toEqual(["PROFILE_PUB_BIO"]);
  });

  it("a look change sends the whole look and the switch, never a private key", async () => {
    // a preset changes a dozen keys and announces one (presets.ui.ts)
    expect(await pushesFor("CUSTOM_ACCENT_COLOR")).toBe(1);
    expect(sent()).toEqual([...PUBLIC_LOOK_KEYS, "CUSTOM_SHARE_LOOK"].sort());
    expect(sent()).not.toContain("CUSTOM_CSS");
    expect(sent()).not.toContain("FRIENDS_LIST");
  });

  it("turning sharing off sends the switch alone", async () => {
    await chrome.storage.local.set({ CUSTOM_SHARE_LOOK: false });
    expect(await pushesFor("CUSTOM_SHARE_LOOK")).toBe(1);
    expect(account.pushPartial.mock.calls[0][0]).toEqual({ CUSTOM_SHARE_LOOK: false });
  });

  it("one push per burst, a few seconds after its last change", async () => {
    const { publishLookIfShared } = await publish();
    publishLookIfShared("CUSTOM_ACCENT_COLOR");
    await vi.advanceTimersByTimeAsync(DELAY - 500);
    publishLookIfShared("PROFILE_THEME_PRESET");
    publishLookIfShared("PROFILE_PUB_BIO");
    await vi.advanceTimersByTimeAsync(DELAY - 500);
    expect(account.pushPartial).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(account.pushPartial).toHaveBeenCalledTimes(1);
    expect(sent()).toContain("PROFILE_PUB_BIO");
    expect(sent()).toContain("PROFILE_THEME_PRESET");
    expect(await pending()).toEqual({});
  });
});

describe("a change that outlives its page", () => {
  it("is kept in storage during the wait, and the next page sends it", async () => {
    const first = await publish();
    first.publishLookIfShared("PROFILE_PUB_BIO");
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(await pending())).toEqual(["PROFILE_PUB_BIO"]);
    // the page reloads before the timer: a new module (the old timer never
    // fires: the clock does not reach it)
    vi.resetModules();
    const next = await publish();
    await next.publishDefaultLookOnce();
    expect(account.pushPartial).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(["PROFILE_PUB_BIO"]);
    expect(await pending()).toEqual({});
  });

  it("waits while the restore question is open or the sign-in lapsed", async () => {
    await chrome.storage.local.set({ LOOK_PUBLISH_PENDING: { PROFILE_PUB_BIO: 1 } });
    const { flushLookPublish } = await publish();
    await chrome.storage.local.set({ PENDING_SETTINGS_RESTORE: true });
    await flushLookPublish();
    await chrome.storage.local.set({ PENDING_SETTINGS_RESTORE: false, CLOUD_AUTH_FAILED: true });
    await flushLookPublish();
    expect(account.pushPartial).not.toHaveBeenCalled();
    expect(Object.keys(await pending())).toEqual(["PROFILE_PUB_BIO"]);
  });

  it("stays pending after a failure that can pass, not after one that cannot", async () => {
    await chrome.storage.local.set({ LOOK_PUBLISH_PENDING: { PROFILE_PUB_BIO: 1 } });
    const { flushLookPublish } = await publish();
    account.pushPartial.mockImplementationOnce(async () => "network");
    await flushLookPublish();
    expect(Object.keys(await pending())).toEqual(["PROFILE_PUB_BIO"]);
    account.pushPartial.mockImplementationOnce(async () => "too-large");
    await flushLookPublish();
    expect(await pending()).toEqual({});
  });

  it("asks nothing again the day the server's write budget ran out", async () => {
    await chrome.storage.local.set({ LOOK_PUBLISH_PENDING: { PROFILE_PUB_BIO: 1 } });
    account.getPushFailure.mockImplementation(async () => ({ reason: "daily-limit", at: Date.now() }));
    const { flushLookPublish } = await publish();
    await flushLookPublish();
    expect(account.pushPartial).not.toHaveBeenCalled();
    // the next day it goes (getPushFailure no longer reports yesterday's:
    // account-settings-rev.test.ts)
    account.getPushFailure.mockImplementation(async () => null);
    await flushLookPublish();
    expect(account.pushPartial).toHaveBeenCalledTimes(1);
  });

  it("a change made while its push is out stays for the next one", async () => {
    await chrome.storage.local.set({ LOOK_PUBLISH_PENDING: { PROFILE_PUB_BIO: 1 } });
    const { flushLookPublish, publishLookIfShared } = await publish();
    account.pushPartial.mockImplementationOnce(async () => {
      publishLookIfShared("PROFILE_PUB_PRONOUNS");
      return "ok";
    });
    await flushLookPublish();
    expect(Object.keys(await pending())).toEqual(["PROFILE_PUB_PRONOUNS"]);
  });

  it("with Auto push on, a hub change is left to the hub's own push", async () => {
    await chrome.storage.local.set({ CLOUD_SYNC_ENABLED: true });
    expect(await pushesFor("CUSTOM_ACCENT_COLOR")).toBe(0);
    expect(await pending()).toEqual({});
  });

  it("signed out: nothing is sent", async () => {
    await chrome.storage.local.remove("CLOUD_TOKEN");
    expect(await pushesFor("PROFILE_PUB_BIO")).toBe(0);
  });
});
