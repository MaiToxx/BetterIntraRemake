import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, CONFIG_DEFAULT } from "../src/core/config";

beforeEach(() => {
  (chrome.storage.local.clear as any)();
});

describe("getConfig", () => {
  it("returns the default when storage is empty", async () => {
    const value = await getConfig("LOGTIME_GOAL_HOURS");
    expect(value).toBe(CONFIG_DEFAULT.LOGTIME_GOAL_HOURS);
  });

  it("returns the default for a string key", async () => {
    const value = await getConfig("PROFILE_IMAGE_URL");
    expect(value).toBe(CONFIG_DEFAULT.PROFILE_IMAGE_URL);
  });

  it("returns the default for an array key", async () => {
    const value = await getConfig("ACTIVE_SCRIPTS");
    expect(value).toEqual(CONFIG_DEFAULT.ACTIVE_SCRIPTS);
  });

  it("returns a stored string value", async () => {
    await chrome.storage.local.set({ LOGTIME_EMOJI: "🍕" });
    const value = await getConfig("LOGTIME_EMOJI");
    expect(value).toBe("🍕");
  });

  it("returns a stored number value", async () => {
    await chrome.storage.local.set({ LOGTIME_GOAL_HOURS: 200 });
    const value = await getConfig("LOGTIME_GOAL_HOURS");
    expect(value).toBe(200);
  });

  it("returns a stored boolean value", async () => {
    await chrome.storage.local.set({ CLOUD_SYNC_ENABLED: true });
    const value = await getConfig("CLOUD_SYNC_ENABLED");
    expect(value).toBe(true);
  });

  it("parses a JSON-stringified array from storage (legacy compat)", async () => {
    await chrome.storage.local.set({ ACTIVE_SCRIPTS: JSON.stringify(["logtime", "profile"]) });
    const value = await getConfig("ACTIVE_SCRIPTS");
    expect(value).toEqual(["logtime", "profile"]);
  });

  it("returns the default when stored value is undefined", async () => {
    await chrome.storage.local.set({ LOGTIME_GOAL_HOURS: undefined });
    const value = await getConfig("LOGTIME_GOAL_HOURS");
    expect(value).toBe(CONFIG_DEFAULT.LOGTIME_GOAL_HOURS);
  });
});

describe("PROFILE_CARD_ORDER normalisation", () => {
  it("survives non-string items instead of throwing on every later read", async () => {
    await chrome.storage.local.set({ PROFILE_CARD_ORDER: [1, 2] });
    await expect(getConfig("PROFILE_CARD_ORDER")).resolves.toEqual(CONFIG_DEFAULT.PROFILE_CARD_ORDER);
    await chrome.storage.local.set({ PROFILE_CARD_ORDER: [42, "LOGTIME"] });
    const mixed = await getConfig("PROFILE_CARD_ORDER");
    expect(mixed[0]).toBe("LOGTIME");
    expect(mixed).toHaveLength(CONFIG_DEFAULT.PROFILE_CARD_ORDER.length);
  });

  it("keeps hidden cards (a leading '-') as they are", async () => {
    await chrome.storage.local.set({ PROFILE_CARD_ORDER: ["-MARKS", "LOGTIME"] });
    const order = await getConfig("PROFILE_CARD_ORDER");
    expect(order.slice(0, 2)).toEqual(["-MARKS", "LOGTIME"]);
  });
});

describe("isValidStoredValue", () => {
  it("checks the items of a list, not only that it is one", async () => {
    const { isValidStoredValue } = await import("../src/core/config/access.ts");
    expect(isValidStoredValue("PROFILE_CARD_ORDER", [1, 2])).toBe(false);
    expect(isValidStoredValue("PROFILE_CARD_ORDER", ["-MARKS", "LOGTIME"])).toBe(true);
    expect(isValidStoredValue("FRIENDS_LIST", [42])).toBe(false);
    expect(isValidStoredValue("SHORTCUTS_LINKS", [1])).toBe(false);
    expect(isValidStoredValue("SHORTCUTS_LINKS", [{ name: "x", url: "https://x" }])).toBe(true);
    expect(isValidStoredValue("LOGTIME_GOAL_HOURS", Number.NaN)).toBe(false);
    expect(isValidStoredValue("LOGTIME_GOAL_HOURS", 140)).toBe(true);
    expect(isValidStoredValue("CUSTOM_CARDS", [])).toBe(false);
    expect(isValidStoredValue("CUSTOM_CARDS", {})).toBe(true);
    expect(isValidStoredValue("ACCOUNT", null)).toBe(true);
    expect(isValidStoredValue("NOT_A_KEY", 1)).toBe(false);
  });
});

describe("cloud sync policy", () => {
  it("every setting is either synced or listed as local on purpose", async () => {
    const { CLOUD_SYNC_KEYS, LOCAL_ONLY_KEYS, VISUAL_CLOUD_KEYS } = await import(
      "../src/core/config/keys.ts"
    );
    const synced = new Set<string>(CLOUD_SYNC_KEYS);
    const local = new Set<string>(LOCAL_ONLY_KEYS);
    const missing = Object.keys(CONFIG_DEFAULT).filter((k) => !synced.has(k) && !local.has(k));
    const both = [...local].filter((k) => synced.has(k));
    expect(missing).toEqual([]);
    expect(both).toEqual([]);
    for (const key of VISUAL_CLOUD_KEYS) expect(synced.has(key), key).toBe(true);
  });

  it("badge order and wrap travel with the badge colour; the push mode stays on the device", async () => {
    const { CLOUD_SYNC_KEYS, VISUAL_CLOUD_KEYS } = await import("../src/core/config/keys.ts");
    expect(CLOUD_SYNC_KEYS).toContain("PROFILE_BADGE_ORDER");
    expect(CLOUD_SYNC_KEYS).toContain("PROFILE_BADGE_WRAP");
    expect(VISUAL_CLOUD_KEYS).toContain("PROFILE_BADGE_ORDER");
    expect(CLOUD_SYNC_KEYS).not.toContain("CLOUD_SYNC_ENABLED");
  });
});
