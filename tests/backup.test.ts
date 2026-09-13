import { describe, it, expect } from "vitest";
import {
  BACKUP_EXCLUDED_KEYS,
  exportableSettings,
  sanitizeBackup,
} from "../src/features/hub/backup";
import { CONFIG_DEFAULT } from "../src/config";

describe("exportableSettings", () => {
  it("drops credentials and caches, keeps regular settings", () => {
    const out = exportableSettings({
      LOGTIME_GOAL_HOURS: 120,
      CLOUD_TOKEN: "secret",
      CLOUD_LOGIN: "me",
      CALENDAR_SYNC_TOKEN: "cal-secret",
      FRIENDS_DATA_CACHE: { data: [], timestamp: 1 },
      NOT_A_SETTING: "x",
    });
    expect(out).toEqual({ LOGTIME_GOAL_HOURS: 120 });
  });

  it("excludes every key listed in BACKUP_EXCLUDED_KEYS", () => {
    const items: Record<string, unknown> = {};
    for (const key of BACKUP_EXCLUDED_KEYS) items[key] = "value";
    expect(exportableSettings(items)).toEqual({});
  });
});

describe("sanitizeBackup", () => {
  it("throws on non-object payloads", () => {
    expect(() => sanitizeBackup(null)).toThrow();
    expect(() => sanitizeBackup([1, 2])).toThrow();
    expect(() => sanitizeBackup("x")).toThrow();
  });

  it("refuses to restore credentials from a backup file", () => {
    const out = sanitizeBackup({
      CLOUD_TOKEN: "attacker-token",
      CLOUD_LOGIN: "attacker",
      DISCORD_ID: "123",
      PENDING_SETTINGS_RESTORE: true,
    });
    expect(out).not.toHaveProperty("CLOUD_TOKEN");
    expect(out).not.toHaveProperty("CLOUD_LOGIN");
    expect(out).not.toHaveProperty("PENDING_SETTINGS_RESTORE");
    // DISCORD_ID is a regular string setting and may be restored
    expect(out.DISCORD_ID).toBe("123");
  });

  it("drops values whose type does not match the default", () => {
    const out = sanitizeBackup({
      ACTIVE_SCRIPTS: {}, // must be an array
      LOGTIME_GOAL_HOURS: "140", // must be a number
      FRIENDS_LIST: ["a", "b"],
      PROFILE_SHOW_MARKS: "true", // must be a boolean
      LOGTIME_EMOJI: "🍕",
    });
    expect(out).toEqual({ FRIENDS_LIST: ["a", "b"], LOGTIME_EMOJI: "🍕" });
  });

  it("accepts null for nullable keys", () => {
    const out = sanitizeBackup({ ACCOUNT: null, LAST_CLOUD_SYNC: null });
    // both are excluded as session state, so nothing is restored
    expect(out).toEqual({});
  });

  it("round-trips a clean export", () => {
    const exported = exportableSettings({ ...CONFIG_DEFAULT });
    expect(sanitizeBackup(exported)).toEqual(exported);
  });
});
