/**
 * A failed push says why, and stays visible: the worker's 413 ("Setting
 * CUSTOM_CSS too long") and 429 are their own reasons instead of a "check the
 * connection", and the pushes nobody waits for (friends, public profile, look,
 * auto push) leave the reason where the popup shows it until one succeeds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  describeCloudFailure,
  getPushFailure,
  logoutCloud,
  pushSettings,
  syncMyVisuals,
  syncToCloud,
  PUSH_FAILURE_KEY,
} from "../src/features/account/account.ts";
import { initAccountSettings } from "../src/features/account/account.ui.ts";
import { createHandlers } from "../src/features/account/handlers.ts";
import { createInitialState } from "../src/features/account/state.ts";

let reply: (url: URL, init: RequestInit) => Response = () =>
  new Response("Saved", { status: 200 });

const settle = () => new Promise((r) => setTimeout(r, 0));
const text = (root: HTMLElement) => root.textContent!.replace(/\s+/g, " ");

const TOO_LONG = "Setting CUSTOM_CSS too long (max 8 KB)";

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CLOUD_LOGIN: "alice" });
  (globalThis as any).chrome.tabs = { query: vi.fn(async () => []) };
  (globalThis as any).fetch = vi.fn(async (rawUrl: string, init: RequestInit) =>
    reply(new URL(rawUrl), init),
  );
});

describe("pushSettings", () => {
  it("names a 413 'too-large' and keeps the worker's words", async () => {
    reply = () => new Response(TOO_LONG, { status: 413 });
    await expect(pushSettings()).resolves.toBe("too-large");
    await expect(getPushFailure()).resolves.toMatchObject({
      reason: "too-large",
      detail: TOO_LONG,
    });
    const sentence = describeCloudFailure("too-large", TOO_LONG);
    expect(sentence).toContain(TOO_LONG);
    expect(sentence).not.toMatch(/connection/i);
  });

  it("names the rate limit 'busy', not a connection problem", async () => {
    reply = () =>
      new Response("Too many requests, retry in a minute", { status: 429 });
    await expect(pushSettings()).resolves.toBe("busy");
    expect(describeCloudFailure("busy")).toMatch(/wait a minute/i);
  });

  it("forgets the failure once a push goes through", async () => {
    reply = () => new Response(TOO_LONG, { status: 413 });
    await pushSettings();
    reply = () => new Response("Saved", { status: 200 });
    await expect(pushSettings()).resolves.toBe("ok");
    await expect(getPushFailure()).resolves.toBeNull();
  });

  it("leaves an expired session to the sign-in prompt", async () => {
    reply = () => new Response("Unauthorized", { status: 401 });
    await expect(pushSettings()).resolves.toBe("auth");
    await expect(getPushFailure()).resolves.toBeNull();
  });

  it("a visuals-only push that fits does not hide a full push that does not", async () => {
    reply = () => new Response(TOO_LONG, { status: 413 });
    await pushSettings();
    reply = () => new Response("Saved", { status: 200 });
    await syncMyVisuals({ avatar: "", banner: "", background: "" });
    await expect(getPushFailure()).resolves.toMatchObject({
      reason: "too-large",
    });
  });

  it("signing out forgets it with the session", async () => {
    reply = () => new Response(TOO_LONG, { status: 413 });
    await pushSettings();
    reply = () => new Response("", { status: 200 });
    await logoutCloud();
    expect((await chrome.storage.local.get(PUSH_FAILURE_KEY))[PUSH_FAILURE_KEY])
      .toBeUndefined();
  });
});

describe("the popup", () => {
  it("shows why a push nobody waited for failed", async () => {
    // e.g. friends.ui.ts: `syncToCloud();`, result ignored
    reply = (url, init) =>
      init.method === "POST"
        ? new Response(TOO_LONG, { status: 413 })
        : new Response('{"activeSessions":1}', { status: 200 });
    await expect(syncToCloud()).resolves.toBe(false);

    const root = document.createElement("div");
    await initAccountSettings(root);
    await settle();
    const line = root.querySelector("#push-failure")!;
    expect(line).not.toBeNull();
    expect(text(line as HTMLElement)).toContain("Last push failed");
    expect(text(line as HTMLElement)).toContain(TOO_LONG);
  });

  it("labels the Push button for a 413 and a 429", async () => {
    const state = createInitialState();
    state.login = "alice";
    state.token = "sess";
    const handlers = createHandlers(state, () => {});

    reply = () => new Response(TOO_LONG, { status: 413 });
    await handlers.handlePush();
    expect(state.buttons.push.text).toBe("Too large");

    state.buttons.push.loading = false;
    reply = () => new Response("Too many requests", { status: 429 });
    await handlers.handlePush();
    expect(state.buttons.push.text).toBe("Too many requests");
    // a refusal is not the worker being unreachable
    expect(state.cloud).not.toBe("offline");
  });
});
