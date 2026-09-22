/**
 * workerFetch, the one client every request to the worker goes through: the
 * deadline, the hashed login and Bearer header, the body parsing (the worker
 * answers a crash with a JSON {error, message} 500) and the single place a
 * 401 becomes CLOUD_AUTH_FAILED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WORKER_TIMEOUT_MS,
  hashedLogin,
  workerFetch,
} from "../src/core/worker.ts";
import { hashLogin } from "../src/core/crypto.ts";

type Reply = Response | "hang" | "network";
let reply: Reply = new Response("{}", { status: 200 });
const calls: { url: string; init: RequestInit }[] = [];

beforeEach(async () => {
  await chrome.storage.local.clear();
  calls.length = 0;
  (globalThis as any).fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (reply === "network") throw new TypeError("Failed to fetch");
    if (reply === "hang") {
      return new Promise<Response>((_, reject) => {
        init.signal!.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }
    return reply;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("workerFetch", () => {
  it("appends the hashed login and the Bearer header with `auth`", async () => {
    reply = new Response("{}", { status: 200 });
    await workerFetch("/api/v1/private/settings?all=true", {
      auth: { login: "Alice ", token: "sess" },
    });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/v1/private/settings");
    expect(url.searchParams.get("all")).toBe("true");
    expect(url.searchParams.get("login")).toBe(await hashLogin("alice"));
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer sess");
  });

  it("sends an object body as JSON and leaves a string body alone", async () => {
    reply = new Response("Saved", { status: 200 });
    await workerFetch("/x", { method: "POST", body: { a: 1 } });
    expect(calls[0].init.body).toBe('{"a":1}');
    expect(
      (calls[0].init.headers as Record<string, string>)["Content-Type"],
    ).toBe("application/json");
    reply = new Response("Saved", { status: 200 });
    const res = await workerFetch("/x", { method: "POST", body: "raw" });
    expect(calls[1].init.body).toBe("raw");
    expect(res).toMatchObject({
      ok: true,
      status: 200,
      json: null,
      text: "Saved",
    });
  });

  it("parses a JSON body and surfaces the worker's {error, message} on a 500", async () => {
    reply = new Response(
      JSON.stringify({ error: "server_error", message: "KV put failed" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
    const res = await workerFetch("/x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.error).toBe("server_error");
    expect(res.message).toBe("KV put failed");
    expect(res.json).toEqual({
      error: "server_error",
      message: "KV put failed",
    });
  });

  it("gives up after the deadline and reports a timeout, never throws", async () => {
    vi.useFakeTimers();
    reply = "hang";
    const pending = workerFetch("/slow");
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res).toMatchObject({ ok: false, status: 0, timedOut: true });
  });

  it("honours a per-call deadline", async () => {
    vi.useFakeTimers();
    reply = "hang";
    const pending = workerFetch("/slow", { timeoutMs: 20_000 });
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS + 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await pending).timedOut).toBe(true);
  });

  it("reports a network error as status 0 without a timeout", async () => {
    reply = "network";
    const res = await workerFetch("/x");
    expect(res).toMatchObject({ ok: false, status: 0, timedOut: false });
  });

  it("flags CLOUD_AUTH_FAILED on a 401 of an authenticated call only", async () => {
    reply = new Response("Unauthorized", { status: 401 });
    await workerFetch("/x", { auth: { login: "alice", token: "old" } });
    expect(
      (await chrome.storage.local.get("CLOUD_AUTH_FAILED")).CLOUD_AUTH_FAILED,
    ).toBe(true);

    await chrome.storage.local.clear();
    for (const status of [403, 404, 500]) {
      reply = new Response("no", { status });
      await workerFetch("/x", { auth: { login: "alice", token: "old" } });
    }
    reply = new Response("Unauthorized", { status: 401 });
    await workerFetch("/auth/intra", { method: "POST", body: { token: "t" } });
    expect(
      (await chrome.storage.local.get("CLOUD_AUTH_FAILED")).CLOUD_AUTH_FAILED,
    ).toBeUndefined();
  });

  it("hashes a login once, whatever its case or spacing", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest");
    const a = await hashedLogin("Bob");
    const b = await hashedLogin(" bob ");
    expect(a).toBe(b);
    expect(a).toBe(await hashLogin("bob"));
    // one SubtleCrypto call for both hashedLogin() calls (hashLogin above adds its own)
    expect(digest.mock.calls.length).toBeLessThanOrEqual(2);
    digest.mockRestore();
  });
});
