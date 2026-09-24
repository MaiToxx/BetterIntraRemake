/**
 * A fresh sign-in asks "Restore your settings?". Until it is answered this
 * browser holds defaults, and a push replaces the cloud copy key by key: the
 * automatic pushes wait, and the question's flag stays until it is answered.
 * It used to be removed before the backup was even read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const confirm = vi.hoisted(() => ({ answer: vi.fn(async () => false) }));
vi.mock("../src/core/dom/confirm-dialog.ts", () => ({ showConfirmDialog: confirm.answer }));

import { maybePromptRestore, pushSettings, syncToCloud } from "../src/features/account/account.ts";

const posts: unknown[] = [];
let settingsReply: () => Response;

beforeEach(async () => {
  posts.length = 0;
  confirm.answer.mockReset();
  confirm.answer.mockResolvedValue(false);
  settingsReply = () =>
    new Response(JSON.stringify({ settings: { FRIENDS_LIST: ["bob"] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CLOUD_LOGIN: "alice" });
  (globalThis as any).fetch = vi.fn(async (_url: string, init: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return new Response("Saved", { status: 200 });
    }
    return settingsReply();
  });
});

const pending = async () =>
  (await chrome.storage.local.get("PENDING_SETTINGS_RESTORE")).PENDING_SETTINGS_RESTORE;

describe("pushes wait for the restore question", () => {
  it("an automatic push does nothing while the question is open", async () => {
    await chrome.storage.local.set({ PENDING_SETTINGS_RESTORE: true });
    await expect(syncToCloud()).resolves.toBe(false);
    expect(posts).toHaveLength(0);
  });

  it("the Push button still pushes: that one is the user's call", async () => {
    await chrome.storage.local.set({ PENDING_SETTINGS_RESTORE: true });
    await expect(pushSettings()).resolves.toBe("ok");
    expect(posts).toHaveLength(1);
  });

  it("the flag stays until the question is answered, then pushes resume", async () => {
    await chrome.storage.local.set({ PENDING_SETTINGS_RESTORE: true });
    let answer!: (v: boolean) => void;
    confirm.answer.mockImplementation(() => new Promise<boolean>((r) => (answer = r)));
    const asked = maybePromptRestore();
    await vi.waitFor(() => expect(confirm.answer).toHaveBeenCalledTimes(1));
    // the dialog is open: still pending, and a push in the meantime waits
    expect(await pending()).toBe(true);
    await expect(syncToCloud()).resolves.toBe(false);
    answer(false);
    await asked;
    expect(await pending()).toBeUndefined();
    await expect(syncToCloud()).resolves.toBe(true);
    expect(posts).toHaveLength(1);
  });

  it("no answer from the server: asked again next time, nothing pushed meanwhile", async () => {
    await chrome.storage.local.set({ PENDING_SETTINGS_RESTORE: true });
    settingsReply = () => new Response("down", { status: 503 });
    await maybePromptRestore();
    expect(confirm.answer).not.toHaveBeenCalled();
    expect(await pending()).toBe(true);
  });

  it("an empty backup clears the flag without asking", async () => {
    await chrome.storage.local.set({ PENDING_SETTINGS_RESTORE: true });
    settingsReply = () =>
      new Response(JSON.stringify({ settings: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    await maybePromptRestore();
    expect(confirm.answer).not.toHaveBeenCalled();
    expect(await pending()).toBeUndefined();
  });
});
