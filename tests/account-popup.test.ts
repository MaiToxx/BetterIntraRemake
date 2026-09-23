/**
 * The popup's account tab: painted from storage before the worker answers,
 * one request per Push and per Pull, and a failure named for what it is
 * (worker unreachable, session gone, empty backup).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The real SubtleCrypto digest completes on Node's threadpool, not in a
// microtask, so the first worker request of the file needs more than the one
// setTimeout(0) the first-paint cases wait. Only the case that ran first
// absorbed it (its loop waits for the request): run alone (-t, .only) or in
// another order, the others still read "Checking...", leaked their request
// into the next case, and the fake-timer Push case advanced its clock before
// the abort timer existed. With an async stub every step is a microtask.
vi.mock("../src/core/crypto.ts", () => ({
  hashLogin: vi.fn(async (login: string) => `hashed-${login}`),
}));

import { initAccountSettings } from "../src/features/account/account.ui.ts";
import { createHandlers } from "../src/features/account/handlers.ts";
import { createInitialState } from "../src/features/account/state.ts";
import { WORKER_TIMEOUT_MS } from "../src/core/worker.ts";

type Reply = (url: URL, init: RequestInit) => Response | "hang";
let reply: Reply = () => new Response("{}", { status: 200 });
const calls: { url: URL; init: RequestInit }[] = [];
let release: (() => void)[] = [];

const settle = () => new Promise((r) => setTimeout(r, 0));
const text = (root: HTMLElement) => root.textContent!.replace(/\s+/g, " ");

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CLOUD_LOGIN: "alice" });
  calls.length = 0;
  release = [];
  (globalThis as any).chrome.tabs = { query: vi.fn(async () => []) };
  (globalThis as any).confirm = () => true;
  (globalThis as any).fetch = vi.fn(
    async (rawUrl: string, init: RequestInit) => {
      const url = new URL(rawUrl);
      calls.push({ url, init });
      const answer = reply(url, init);
      if (answer !== "hang") return answer;
      return new Promise<Response>((resolve, reject) => {
        release.push(() =>
          resolve(new Response('{"activeSessions":4}', { status: 200 })),
        );
        init.signal!.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("first paint", () => {
  it("renders the card from storage while the worker has not answered", async () => {
    await chrome.storage.local.set({ CLOUD_LAST_SESSIONS: 3 });
    reply = () => "hang";
    const root = document.createElement("div");
    await initAccountSettings(root);
    expect(text(root)).toContain("alice");
    expect(text(root)).toContain("Checking...");
    expect(text(root)).toContain("3/10");
    expect(root.querySelector("#push-cloud-btn")).not.toBeNull();

    // the request starts after the paint, not before it
    while (!release.length) await settle();
    expect(text(root)).toContain("Checking...");
    release[0]();
    await settle();
    expect(text(root)).toContain("Online");
    expect(text(root)).toContain("4/10");
    expect(
      (await chrome.storage.local.get("CLOUD_LAST_SESSIONS"))
        .CLOUD_LAST_SESSIONS,
    ).toBe(4);
  });

  it("asks for the metadata only, and falls back to the full document on 404", async () => {
    reply = (url) =>
      url.searchParams.get("fields") === "meta"
        ? new Response("Not found", { status: 404 })
        : new Response(
            JSON.stringify({ settings: { a: 1 }, activeSessions: 2 }),
            {
              status: 200,
            },
          );
    const root = document.createElement("div");
    await initAccountSettings(root);
    await settle();
    expect(calls.map((c) => c.url.searchParams.get("fields"))).toEqual([
      "meta",
      null,
    ]);
    expect(
      calls.every((c) => c.url.pathname === "/api/v1/private/settings"),
    ).toBe(true);
    expect(text(root)).toContain("2/10");
    expect(text(root)).toContain("Online");
  });

  it("says the server is unreachable, and keeps the last known count, when the worker does not answer", async () => {
    await chrome.storage.local.set({ CLOUD_LAST_SESSIONS: 3 });
    reply = () => {
      throw new TypeError("Failed to fetch");
    };
    const root = document.createElement("div");
    await initAccountSettings(root);
    await settle();
    expect(text(root)).toContain("Unreachable");
    expect(text(root)).toContain("3/10");
    expect(text(root)).not.toContain("Session expired");
  });

  it("offers to sign in again on the same open when the probe gets a 401", async () => {
    reply = () => new Response("Unauthorized", { status: 401 });
    const root = document.createElement("div");
    await initAccountSettings(root);
    await settle();
    expect(text(root)).toContain("Session expired");
    expect(root.textContent).toContain("Sign in again");
  });

  it("treats a wiped account (404 on the private settings) as an expired session, keeping the token", async () => {
    reply = () => new Response("User not found", { status: 404 });
    const root = document.createElement("div");
    await initAccountSettings(root);
    await settle();
    const store = await chrome.storage.local.get(null);
    expect(store.CLOUD_AUTH_FAILED).toBe(true);
    expect(store.CLOUD_TOKEN).toBe("sess");
    expect(store.CLOUD_LOGIN).toBe("alice");
    expect(text(root)).toContain("Session expired");
  });
});

function harness() {
  const state = createInitialState();
  state.login = "alice";
  state.token = "sess";
  const renders: string[] = [];
  const handlers = createHandlers(state, () =>
    renders.push(state.buttons.push.text + "|" + state.buttons.pull.text),
  );
  return { state, handlers, renders };
}

describe("Push", () => {
  it("is a single POST, with no probe before it", async () => {
    reply = () => new Response("Saved", { status: 200 });
    const { state, handlers } = harness();
    await handlers.handlePush();
    expect(calls.map((c) => c.init.method)).toEqual(["POST"]);
    expect(state.buttons.push.text).toBe("Synced!");
    expect(state.cloud).toBe("online");
  });

  it("names a worker that does not answer in time", async () => {
    vi.useFakeTimers();
    reply = () => "hang";
    const { state, handlers } = harness();
    const done = handlers.handlePush();
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS + 1);
    await done;
    expect(state.buttons.push.text).toBe("Connection Failed");
    expect(state.cloud).toBe("offline");
  });

  it("names an expired session and a worker error apart", async () => {
    reply = () => new Response("Unauthorized", { status: 401 });
    const a = harness();
    await a.handlers.handlePush();
    expect(a.state.buttons.push.text).toBe("Session expired");
    expect(
      (await chrome.storage.local.get("CLOUD_AUTH_FAILED")).CLOUD_AUTH_FAILED,
    ).toBe(true);

    reply = () =>
      new Response(JSON.stringify({ error: "server_error", message: "KV" }), {
        status: 500,
      });
    const b = harness();
    await b.handlers.handlePush();
    expect(b.state.buttons.push.text).toBe("Sync Failed");
  });
});

describe("Pull", () => {
  it("is a single GET that restores the settings and refreshes the count", async () => {
    reply = () =>
      new Response(
        JSON.stringify({ settings: { LOGTIME_EMOJI: "x" }, activeSessions: 5 }),
        { status: 200 },
      );
    const { state, handlers } = harness();
    await handlers.handlePull();
    expect(calls.length).toBe(1);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].url.searchParams.get("fields")).toBeNull();
    expect(state.buttons.pull.text).toBe("Restored!");
    expect(state.activeSessions).toBe(5);
    expect(
      (await chrome.storage.local.get("LOGTIME_EMOJI")).LOGTIME_EMOJI,
    ).toBe("x");
  });

  it("does not call an unreachable worker 'No Data Found'", async () => {
    reply = () => {
      throw new TypeError("Failed to fetch");
    };
    const { state, handlers } = harness();
    await handlers.handlePull();
    expect(state.buttons.pull.text).toBe("Connection Failed");
    expect(calls.length).toBe(1);
  });

  it("says the backup is empty when the document holds nothing", async () => {
    reply = () =>
      new Response(JSON.stringify({ settings: {}, activeSessions: 1 }), {
        status: 200,
      });
    const { state, handlers } = harness();
    await handlers.handlePull();
    expect(state.buttons.pull.text).toBe("No backup yet");
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it("says the session expired on a 401", async () => {
    reply = () => new Response("Unauthorized", { status: 401 });
    const { state, handlers } = harness();
    await handlers.handlePull();
    expect(state.buttons.pull.text).toBe("Session expired");
  });
});
