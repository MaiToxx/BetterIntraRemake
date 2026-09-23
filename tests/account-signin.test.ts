/**
 * Signing in (intra mode, the mode this repo builds): nothing reaches the
 * worker before the sign-in notice was accepted on this browser, a double
 * click opens one notice and one worker session, and a refusal reads as what
 * to do, inline for the callers that ask for it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

vi.mock("../src/core/worker.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/worker.ts")>()),
  AUTH_MODE: "intra",
}));
vi.mock("../src/core/intra/intrapy.ts", () => ({
  waitForIntrapyToken: async () => "Bearer intra-jwt",
  getStoredIntrapyToken: () => null,
  isJwtExpired: () => false,
}));

import { loginWith42 } from "../src/features/account/account.ts";
import { loginWithIntraSession } from "../src/features/account/intra-login.ts";
import { WORKER_HOST } from "../src/core/worker.ts";

let reply: () => Response | Promise<Response> = () =>
  new Response(JSON.stringify({ token: "sess", login: "alice" }), {
    status: 200,
  });
const posts: string[] = [];

beforeAll(() => {
  // jsdom has <dialog> but neither showModal() nor close().
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(async () => {
  await chrome.storage.local.clear();
  posts.length = 0;
  document.body.replaceChildren();
  reply = () =>
    new Response(JSON.stringify({ token: "sess", login: "alice" }), {
      status: 200,
    });
  (globalThis as any).fetch = vi.fn(async (rawUrl: string) => {
    posts.push(new URL(rawUrl).pathname);
    return reply();
  });
  (globalThis as any).alert = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const notice = () =>
  document.getElementById("ft-signin-disclosure") as HTMLDialogElement | null;
const noticeRoot = () => notice()!.querySelector("div")!.shadowRoot!;
const noticeButton = (name: RegExp) =>
  [...noticeRoot().querySelectorAll("button")].find((b) =>
    name.test(b.textContent ?? ""),
  ) as HTMLButtonElement;

describe("the sign-in notice", () => {
  it("is shown before anything is sent, names the server and links the privacy policy", async () => {
    const onSuccess = vi.fn();
    const pending = loginWith42(onSuccess);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(posts).toEqual([]);
    const text = noticeRoot().textContent!.replace(/\s+/g, " ");
    expect(text).toContain(WORKER_HOST);
    expect(text).toContain("session token");
    const link = noticeRoot().querySelector("a")!;
    expect(link.href).toMatch(/\/blob\/main\/PRIVACY\.md$/);
    expect(link.rel).toContain("noopener");

    noticeButton(/Sign in/).click();
    await expect(pending).resolves.toMatchObject({ ok: true, login: "alice" });
    expect(posts).toEqual(["/auth/intra"]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(
      (await chrome.storage.local.get("SIGNIN_DISCLOSURE_ACCEPTED"))
        .SIGNIN_DISCLOSURE_ACCEPTED,
    ).toBe(true);
    expect(notice()).toBeNull();
  });

  it("Cancel sends nothing and remembers nothing", async () => {
    const onSuccess = vi.fn();
    const pending = loginWith42(onSuccess);
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    noticeButton(/Cancel/).click();
    await expect(pending).resolves.toMatchObject({ ok: false, cancelled: true });
    expect(posts).toEqual([]);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(
      (await chrome.storage.local.get("SIGNIN_DISCLOSURE_ACCEPTED"))
        .SIGNIN_DISCLOSURE_ACCEPTED,
    ).toBeUndefined();
  });

  it("Escape (the dialog closing by itself) is a refusal, not a hang", async () => {
    const pending = loginWith42(vi.fn());
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    notice()!.close();
    await expect(pending).resolves.toMatchObject({ cancelled: true });
    expect(posts).toEqual([]);
  });

  it("is not shown again once accepted on this browser", async () => {
    await chrome.storage.local.set({ SIGNIN_DISCLOSURE_ACCEPTED: true });
    const res = await loginWith42(vi.fn());
    expect(res).toMatchObject({ ok: true });
    expect(notice()).toBeNull();
    expect(posts).toEqual(["/auth/intra"]);
  });
});

describe("one sign-in at a time", () => {
  it("a double click opens one notice and sends one POST", async () => {
    const first = loginWith42(vi.fn());
    const second = loginWith42(vi.fn());
    await vi.waitFor(() => expect(notice()).not.toBeNull());
    expect(document.querySelectorAll("#ft-signin-disclosure").length).toBe(1);
    noticeButton(/Sign in/).click();
    await Promise.all([first, second]);
    expect(posts).toEqual(["/auth/intra"]);
  });

  it("two buttons at once end in one outcome: one alert, one reload", async () => {
    await chrome.storage.local.set({ SIGNIN_DISCLOSURE_ACCEPTED: true });
    reply = () => new Response("nope", { status: 500 });
    const first = vi.fn();
    const second = vi.fn();
    await Promise.all([loginWith42(first), loginWith42(second)]);
    expect(alert).toHaveBeenCalledTimes(1);

    reply = () =>
      new Response(JSON.stringify({ token: "sess", login: "alice" }), {
        status: 200,
      });
    await Promise.all([loginWith42(first), loginWith42(second)]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("the page shares one request between the popup's message and a button", async () => {
    let release!: () => void;
    reply = () =>
      new Promise<Response>((resolve) => {
        release = () =>
          resolve(
            new Response(JSON.stringify({ token: "sess", login: "alice" }), {
              status: 200,
            }),
          );
      });
    const a = loginWithIntraSession();
    const b = loginWithIntraSession();
    await vi.waitFor(() => expect(posts.length).toBe(1));
    release();
    await expect(a).resolves.toEqual({ ok: true, login: "alice" });
    await expect(b).resolves.toEqual({ ok: true, login: "alice" });
    expect(posts).toEqual(["/auth/intra"]);
    // settled: the next sign-in is a new request
    reply = () =>
      new Response(JSON.stringify({ token: "sess2", login: "alice" }), {
        status: 200,
      });
    await loginWithIntraSession();
    expect(posts.length).toBe(2);
  });
});

describe("a refused sign-in", () => {
  beforeEach(async () => {
    await chrome.storage.local.set({ SIGNIN_DISCLOSURE_ACCEPTED: true });
    reply = () =>
      new Response(JSON.stringify({ error: "bad_token", message: "signature" }), {
        status: 401,
      });
  });

  it("goes to onFailure instead of alert(), what to do first", async () => {
    const onFailure = vi.fn();
    const res = await loginWith42(vi.fn(), { onFailure });
    expect(res).toMatchObject({ ok: false });
    expect(alert).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    const [first, ...rest] = String(onFailure.mock.calls[0][0]).split("\n");
    expect(first).toBe(
      "Intra did not accept this page's session token. Reload the page, then try again.",
    );
    // the raw answer is kept below, for bug reports
    expect(rest.join("\n")).toMatch(/refused the login \(401\): signature/);
  });

  it("still alerts for the callers that pass no onFailure", async () => {
    await loginWith42(vi.fn());
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String((alert as any).mock.calls[0][0])).toMatch(
      /did not accept this page's session token/,
    );
  });

  it("names the key server on a 503", async () => {
    reply = () =>
      new Response("Intra key server unreachable, retry in a minute", {
        status: 503,
      });
    const onFailure = vi.fn();
    await loginWith42(vi.fn(), { onFailure });
    expect(String(onFailure.mock.calls[0][0]).split("\n")[0]).toMatch(
      /42's key server did not answer.*Try again in a minute/,
    );
  });
});
