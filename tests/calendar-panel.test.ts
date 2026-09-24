/**
 * The Calendar card of the hub survives what goes wrong: signed out, the card
 * stays and offers the sign-in instead of a Generate that dead-ends; a failed
 * request keeps the card, the button and the existing link, with the message
 * inside it. Both used to replace the whole card with one line of text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "lit-html";

const account = vi.hoisted(() => ({
  clearAuthFailed: vi.fn(async () => {}),
  loginWith42: vi.fn(async () => {}),
}));
vi.mock("../src/features/account/account.ts", () => account);
// the QR code draws on a canvas, which jsdom has not
vi.mock("../src/features/calendar/qr.ts", () => ({ generateQrDataUrl: () => "data:," }));

import {
  renderCalendarPanel,
  webcalUrl,
  googleCalendarUrl,
} from "../src/features/calendar/calendar.ui.ts";

/** What the worker answers: a real Response, as workerFetch reads its headers. */
const answer = (status: number) => async () =>
  new Response(status === 200 ? "{}" : JSON.stringify({ error: "x" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

async function mount(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(renderCalendarPanel(), host);
  await settle();
  return host;
}

const buttonNamed = (root: ParentNode, text: RegExp) =>
  [...root.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""));

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.body.replaceChildren();
  account.loginWith42.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("calendar panel", () => {
  it("signed out: the card stays and offers Sign in with 42 instead of Generate", async () => {
    const host = await mount();
    expect(host.querySelector(".card")).not.toBeNull();
    expect(host.textContent).toContain("Sign in with your 42 account to generate a calendar link");
    expect(buttonNamed(host, /Generate calendar link/)).toBeUndefined();
    const connect = buttonNamed(host, /Sign in with 42/)!;
    connect.click();
    expect(account.loginWith42).toHaveBeenCalledTimes(1);
  });

  it("signed in, failed request: the card, the message and the button all stay", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "xlogin" });
    vi.stubGlobal("fetch", vi.fn(answer(500)));
    const host = await mount();
    const generate = buttonNamed(host, /Generate calendar link/)!;
    expect(generate).toBeDefined();
    generate.click();
    await settle();
    expect(host.querySelector(".card")).not.toBeNull();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/could not create the link \(error 500\)/);
    expect(buttonNamed(host, /Generate calendar link/)).toBeDefined();
  });

  it("a failed Regenerate keeps the existing link", async () => {
    await chrome.storage.local.set({
      CLOUD_TOKEN: "t",
      CLOUD_LOGIN: "xlogin",
      CALENDAR_SYNC_TOKEN: "old-token",
    });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = await mount();
    buttonNamed(host, /Regenerate/)!.click();
    await settle();
    expect(host.textContent).toContain("old-token.ics");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(buttonNamed(host, /Regenerate/)).toBeDefined();
    expect((await chrome.storage.local.get("CALENDAR_SYNC_TOKEN")).CALENDAR_SYNC_TOKEN).toBe("old-token");
  });

  it("Regenerate asks first: cancelled, the link and the subscriptions stay", async () => {
    await chrome.storage.local.set({
      CLOUD_TOKEN: "t",
      CLOUD_LOGIN: "xlogin",
      CALENDAR_SYNC_TOKEN: "old-token",
    });
    const fetch = vi.fn(answer(200));
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const host = await mount();
    buttonNamed(host, /Regenerate/)!.click();
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/stop updating/);
    expect(fetch).not.toHaveBeenCalled();
    expect((await chrome.storage.local.get("CALENDAR_SYNC_TOKEN")).CALENDAR_SYNC_TOKEN).toBe("old-token");

    confirm.mockReturnValue(true);
    buttonNamed(host, /Regenerate/)!.click();
    await vi.waitFor(async () => {
      expect(fetch).toHaveBeenCalledTimes(1);
      const stored = (await chrome.storage.local.get("CALENDAR_SYNC_TOKEN")).CALENDAR_SYNC_TOKEN;
      expect(stored).not.toBe("old-token");
    });
  });

  it("the first Generate needs no confirmation: there is no link to break", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "xlogin" });
    const fetch = vi.fn(answer(200));
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.spyOn(window, "confirm");
    const host = await mount();
    buttonNamed(host, /Generate calendar link/)!.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("a session that expired mid-way is said inside the card", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "xlogin" });
    const host = await mount();
    await chrome.storage.local.remove(["CLOUD_TOKEN"]);
    buttonNamed(host, /Generate calendar link/)!.click();
    await settle();
    expect(host.querySelector(".card")).not.toBeNull();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Sign in/);
  });

  it("an expired session says so, flags Reconnect and offers the sign-in again", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "xlogin" });
    vi.stubGlobal("fetch", vi.fn(answer(401)));
    const host = await mount();
    buttonNamed(host, /Generate calendar link/)!.click();
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/session has expired/);
    expect((await chrome.storage.local.get("CLOUD_AUTH_FAILED")).CLOUD_AUTH_FAILED).toBe(true);
    buttonNamed(host, /Sign in again/)!.click();
    expect(account.loginWith42).toHaveBeenCalledTimes(1);
  });

  it("a rate limit asks to wait instead of blaming the network", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "xlogin" });
    vi.stubGlobal("fetch", vi.fn(answer(429)));
    const host = await mount();
    buttonNamed(host, /Generate calendar link/)!.click();
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Wait a minute/);
  });

  it("the copy button says Copied, and falls back to a prompt when the clipboard refuses", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "xlogin", CALENDAR_SYNC_TOKEN: "tok" });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const host = await mount();
    const copy = () => host.querySelector<HTMLButtonElement>('button[aria-label="Copy link"], button[aria-label="Link copied"]')!;
    copy().click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/calendar/tok.ics"));
    expect(copy().getAttribute("data-tip")).toBe("Copied!");
    expect(host.querySelector('[role="status"]')!.textContent).toBe("Link copied");

    writeText.mockRejectedValueOnce(new Error("denied"));
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    copy().click();
    await settle();
    expect(prompt).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("/calendar/tok.ics"));
  });

  it("offers one-click subscriptions: the system calendar app and Google Calendar", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "xlogin", CALENDAR_SYNC_TOKEN: "tok" });
    const host = await mount();
    const links = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain(webcalUrl("tok"));
    expect(links).toContain(googleCalendarUrl("tok"));
    expect(webcalUrl("tok")).toMatch(/^webcal:\/\/[^/]+\/calendar\/tok\.ics$/);
    expect(googleCalendarUrl("tok")).toBe(
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl("tok"))}`,
    );
  });
});
