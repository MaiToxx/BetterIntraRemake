/**
 * The one-shot buttons of the Advanced tab. "Reload campus config" fetches
 * first and keeps the cached configuration when the worker is unreachable,
 * saying so under the button (it used to drop the cache, then fail without a
 * word). A backup import confirms what it restores, and asks separately
 * before restoring custom CSS or public profile fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "lit-html";
import {
  confirmBackupImport,
  describeBackup,
  reloadCampusConfig,
  renderAction,
} from "../src/features/hub/controls/actions.ts";
import { ADVANCED_SETTINGS } from "../src/features/hub/settings/advanced.ts";

const reload = vi.fn();
const CACHE = {
  CAMPUS_MANIFEST_V2: { manifest: { campuses: [{ id: "1", name: "Paris" }] }, timestamp: 1 },
  CAMPUS_DATA_1: { data: { clusters: [], definitions: {} }, timestamp: 1 },
};

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLUSTERS_CAMPUS: "1", ...CACHE });
  vi.mocked(chrome.storage.local.remove).mockClear();
  reload.mockClear();
  const loc = { href: "https://profile-v3.intra.42.fr/", protocol: "https:", reload };
  Object.defineProperty(window, "location", { value: loc, writable: true, configurable: true });
  Object.defineProperty(globalThis, "location", { value: loc, writable: true, configurable: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountReloadButton() {
  const def = ADVANCED_SETTINGS.find((d) => d.actionType === "reload-campus")!;
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(renderAction(def), host);
  return {
    button: host.querySelector("button")!,
    status: host.querySelector<HTMLElement>("[data-campus-reload-status]")!,
  };
}

describe("Reload campus config", () => {
  it("keeps the cached configuration and says so when the worker is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { button, status } = mountReloadButton();
    expect(status.classList.contains("hidden")).toBe(true);

    await reloadCampusConfig(button);

    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    const stored = await chrome.storage.local.get(["CAMPUS_MANIFEST_V2", "CAMPUS_DATA_1"]);
    expect(stored).toEqual(CACHE);
    expect(reload).not.toHaveBeenCalled();
    expect(status.classList.contains("hidden")).toBe(false);
    expect(status.textContent).toMatch(/Could not reach the campus configuration/);
    expect(status.getAttribute("role")).toBe("status");
    // ready for another try
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("is disabled while it runs, then reloads the page on success", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const manifest = { campuses: [{ id: "1", name: "Paris" }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        await gate;
        return {
          ok: true,
          json: async () =>
            url.endsWith("campuses.json") ? manifest : { clusters: [{ id: "c1", name: "C1" }], definitions: {} },
        };
      }),
    );
    const { button, status } = mountReloadButton();
    const run = reloadCampusConfig(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    release();
    await run;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(status.classList.contains("hidden")).toBe(true);
    const stored = await chrome.storage.local.get("CAMPUS_DATA_1");
    expect(stored.CAMPUS_DATA_1.data.clusters).toEqual([{ id: "c1", name: "C1" }]);
  });
});

describe("backup import confirmation", () => {
  it("describes what the file holds", () => {
    expect(describeBackup(12, { version: "1.12.1", exportedAt: "2026-09-03T10:00:00.000Z" })).toMatch(
      /^12 settings exported on .*2026 \(v1\.12\.1\)$/,
    );
    expect(describeBackup(1, {})).toBe("1 setting");
    expect(describeBackup(3, { exportedAt: "garbage" })).toBe("3 settings");
  });

  it("asks before overwriting, and stops on no", async () => {
    const ask = vi.fn(() => false);
    const data = { LOGTIME_GOAL_HOURS: 100 };
    expect(await confirmBackupImport(data, "1 setting", ask)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatch(/Restore 1 setting\? Your current settings will be overwritten/);
  });

  it("asks a second time for custom CSS and public profile fields, and drops them on no", async () => {
    const ask = vi.fn((m: string) => !/custom CSS/.test(m));
    const data: Record<string, unknown> = {
      LOGTIME_GOAL_HOURS: 100,
      CUSTOM_CSS: "body{display:none}",
      PROFILE_PUB_BIO: "not my bio",
      PROFILE_PUB_STATUS_TEXT: "",
    };
    expect(await confirmBackupImport(data, "4 settings", ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(Object.keys(data).sort()).toEqual(["LOGTIME_GOAL_HOURS", "PROFILE_PUB_STATUS_TEXT"]);
  });

  it("does not ask twice for a plain backup", async () => {
    const ask = vi.fn(() => true);
    const data = { LOGTIME_GOAL_HOURS: 100, CUSTOM_CSS: "", PROFILE_PUB_BIO: "" };
    expect(await confirmBackupImport(data, "3 settings", ask)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(data.CUSTOM_CSS).toBe("");
  });
});
