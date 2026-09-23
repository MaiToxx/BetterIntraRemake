/**
 * @vitest-environment node
 *
 * The Chrome Web Store package (CHROME_STORE=1) has no GitHub release check:
 * Chrome updates a store install itself, and the check's NEW badge and
 * Download link would send store users to a zip that installs a second copy
 * of the extension. Its manifest has no "alarms" permission, so the built
 * background.js must run with chrome.alarms undefined and still register the
 * listeners the rest of the extension needs.
 *
 * The real vite.background.config.ts is built here, once per variant, so
 * this also checks that the config turns CHROME_STORE=1 into __STORE_BUILD__.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import path from "node:path";
import { build } from "vite";
import { readRepoInfo } from "../scripts/repo-info.js";

const ROOT = path.resolve(__dirname, "..");
const RELEASES_API: string = readRepoInfo().releasesApi;

async function buildBackground(store: boolean): Promise<string> {
  const saved = process.env.CHROME_STORE;
  if (store) process.env.CHROME_STORE = "1";
  else delete process.env.CHROME_STORE;
  try {
    const result = await build({
      configFile: path.join(ROOT, "vite.background.config.ts"),
      root: ROOT,
      logLevel: "silent",
      build: { write: false, outDir: path.join(ROOT, "dist-tmp-store-pipeline") },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{
      output: Array<{ type: string; fileName: string; code?: string }>;
    }>;
    const chunk = outputs
      .flatMap((o) => o.output)
      .find((f) => f.type === "chunk" && f.fileName === "background.js");
    if (!chunk?.code) throw new Error("background.js not in the build output");
    return chunk.code;
  } finally {
    if (saved === undefined) delete process.env.CHROME_STORE;
    else process.env.CHROME_STORE = saved;
  }
}

type Fn = (...args: any[]) => any;

/** A chrome stub that records every listener; `alarms` only when asked for. */
function chromeStub(withAlarms: boolean) {
  const listeners: Record<string, Fn[]> = {};
  const event = (name: string) => ({
    addListener: (fn: Fn) => {
      (listeners[name] ??= []).push(fn);
    },
  });
  const chrome: any = {
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      onInstalled: event("onInstalled"),
      onStartup: event("onStartup"),
      onMessage: event("onMessage"),
    },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
      onChanged: event("onChanged"),
    },
    tabs: { query: vi.fn(async () => []), reload: vi.fn() },
  };
  if (withAlarms) {
    chrome.alarms = {
      get: vi.fn(async () => undefined),
      create: vi.fn(),
      onAlarm: event("onAlarm"),
    };
  }
  return { chrome, listeners };
}

/** Run a built IIFE against a stub, with fetch recorded instead of sent. */
function run(code: string, chrome: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: false, status: 503 }));
  new Function("chrome", "fetch", code)(chrome, fetchMock);
  return fetchMock;
}

describe("background.js, Chrome Web Store build", () => {
  let code: string;
  beforeAll(async () => {
    code = await buildBackground(true);
  }, 60_000);

  it("carries no release check: no GitHub API URL, no alarms", () => {
    expect(RELEASES_API).toContain("api.github.com");
    expect(code).not.toContain("api.github.com");
    expect(code).not.toContain("alarms");
  });

  it("runs without chrome.alarms and still serves the content scripts", async () => {
    const { chrome, listeners } = chromeStub(false);
    const fetchMock = run(code, chrome);

    expect(listeners.onStartup).toBeUndefined();
    expect(listeners.onMessage).toHaveLength(1);
    expect(listeners.onChanged).toHaveLength(1);

    // FT_FETCH_INTRA_PAGE still answers (and still refuses non-Intra URLs)
    const answer = await new Promise((resolve) => {
      listeners.onMessage[0]({ type: "FT_FETCH_INTRA_PAGE", url: "https://evil.example/" }, {}, resolve);
    });
    expect(answer).toEqual({ ok: false });

    // an update still clears a flag an earlier version may have left, and
    // never schedules a check
    expect(() => listeners.onInstalled[0]({ reason: "update" })).not.toThrow();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(["UPDATE_AVAILABLE", "UPDATE_CHECK_META"]);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "" });
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("background.js, GitHub builds (xpi, zip, crx)", () => {
  let code: string;
  beforeAll(async () => {
    code = await buildBackground(false);
  }, 60_000);

  it("keeps the 6-hour release check and its alarm", async () => {
    expect(code).toContain(RELEASES_API);
    const { chrome, listeners } = chromeStub(true);
    const fetchMock = run(code, chrome);

    expect(listeners.onAlarm).toHaveLength(1);
    expect(listeners.onStartup).toHaveLength(1);
    await vi.waitFor(() => expect(chrome.alarms.get).toHaveBeenCalledWith("better-intra-update-check"));
    await vi.waitFor(() => expect(chrome.alarms.create).toHaveBeenCalled());

    listeners.onStartup[0]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(RELEASES_API, expect.anything()));
  });
});
