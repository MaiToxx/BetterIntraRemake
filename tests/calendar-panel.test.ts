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

import { renderCalendarPanel } from "../src/features/calendar/calendar.ui.ts";

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
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    const host = await mount();
    const generate = buttonNamed(host, /Generate calendar link/)!;
    expect(generate).toBeDefined();
    generate.click();
    await settle();
    expect(host.querySelector(".card")).not.toBeNull();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Could not reach the server/);
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
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
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
    const fetch = vi.fn(async () => ({ ok: true, status: 200 }));
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
});
