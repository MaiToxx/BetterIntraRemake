/**
 * Stop sharing: the Calendar card turns the feed off on its own. Only
 * Regenerate (which keeps a feed on the server) and Wipe All Data (which
 * takes the settings backup, images and sessions with it) existed. The
 * worker revokes the link and deletes the stored .ics (DELETE
 * /api/v1/private/calendar/token); afterwards an upload for that login
 * answers 410, which tells a second browser the link was stopped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "lit-html";

const account = vi.hoisted(() => ({
  clearAuthFailed: vi.fn(async () => {}),
  loginWith42: vi.fn(async () => {}),
  forgetCloudCalendarLink: vi.fn(async () => {}),
}));
vi.mock("../src/features/account/account.ts", () => account);
// the QR code draws on a canvas, which jsdom has not
vi.mock("../src/features/calendar/qr.ts", () => ({ generateQrDataUrl: () => "data:," }));

import {
  renderCalendarPanel,
  STOP_SHARING_CONFIRM,
} from "../src/features/calendar/calendar.ui.ts";
import { syncCalendarIcs } from "../src/features/calendar/calendar-sync.ts";
import { hashedLogin } from "../src/core/worker.ts";

const answer = (status: number) => async () =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify({ error: "x" }), {
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

const stored = async () =>
  chrome.storage.local.get(["CALENDAR_SYNC_TOKEN", "CALENDAR_EVENTS_HASH"]);

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    CLOUD_TOKEN: "sess",
    CLOUD_LOGIN: "alice",
    CALENDAR_SYNC_TOKEN: "live-link",
    CALENDAR_EVENTS_HASH: "123",
  });
  document.body.replaceChildren();
  account.forgetCloudCalendarLink.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Stop sharing", () => {
  it("sits next to Regenerate and asks first: cancelled, nothing changes", async () => {
    const fetch = vi.fn(answer(204));
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const host = await mount();
    const stop = buttonNamed(host, /Stop sharing/)!;
    expect(stop.parentElement).toBe(buttonNamed(host, /Regenerate/)!.parentElement);
    stop.click();
    await settle();
    expect(confirm).toHaveBeenCalledWith(STOP_SHARING_CONFIRM);
    expect(STOP_SHARING_CONFIRM).toMatch(/stop updating/);
    expect(STOP_SHARING_CONFIRM).toMatch(/deleted/);
    expect(fetch).not.toHaveBeenCalled();
    expect(await stored()).toEqual({ CALENDAR_SYNC_TOKEN: "live-link", CALENDAR_EVENTS_HASH: "123" });
  });

  it("revokes the link on the worker, forgets it here and brings Generate back", async () => {
    const fetch = vi.fn(answer(204));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = await mount();
    buttonNamed(host, /Stop sharing/)!.click();
    await vi.waitFor(async () => expect(await stored()).toEqual({}));

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.pathname).toBe("/api/v1/private/calendar/token");
    expect(u.searchParams.get("login")).toBe(await hashedLogin("alice"));
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sess");

    await settle();
    expect(host.textContent).not.toContain("live-link");
    expect(buttonNamed(host, /Generate calendar link/)).toBeDefined();
    expect(buttonNamed(host, /Stop sharing/)).toBeUndefined();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    // the link is a synced setting: the cloud copy must lose it too
    expect(account.forgetCloudCalendarLink).toHaveBeenCalledTimes(1);
  });

  it.each([
    // its own words: generateError's said "Sign in again to create the link"
    [401, /session has expired\. Sign in again to stop sharing\./],
    [429, /Wait a minute/],
    [500, /could not stop sharing \(error 500\)/],
  ])("a %s keeps the link and says why", async (status, words) => {
    vi.stubGlobal("fetch", vi.fn(answer(status)));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = await mount();
    buttonNamed(host, /Stop sharing/)!.click();
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(words);
    expect(host.textContent).toContain("live-link.ics");
    expect(buttonNamed(host, /Stop sharing/)!.disabled).toBe(false);
    expect(await stored()).toEqual({ CALENDAR_SYNC_TOKEN: "live-link", CALENDAR_EVENTS_HASH: "123" });
    expect(account.forgetCloudCalendarLink).not.toHaveBeenCalled();
    if (status === 401) expect(buttonNamed(host, /Sign in again/)).toBeDefined();
  });

  it("while the stop is on its way, neither a second stop nor Regenerate can be sent", async () => {
    let release!: () => void;
    const fetch = vi.fn(async () => {
      await new Promise<void>((r) => (release = r));
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = await mount();
    const stop = buttonNamed(host, /Stop sharing/)!;
    // two clicks in a row: the second lands before the first has read storage
    stop.click();
    stop.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(buttonNamed(host, /Stop sharing/)!.disabled).toBe(true);
    // a new link answered after the stop would be one the stop revoked
    expect(buttonNamed(host, /Regenerate/)!.disabled).toBe(true);
    release();
    await vi.waitFor(async () => expect(await stored()).toEqual({}));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("no answer says the server could not be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = await mount();
    buttonNamed(host, /Stop sharing/)!.click();
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Could not reach the server/);
    expect((await stored()).CALENDAR_SYNC_TOKEN).toBe("live-link");
  });

  it("signed out, it asks for the sign-in instead of sending a request", async () => {
    await chrome.storage.local.remove(["CLOUD_TOKEN"]);
    const fetch = vi.fn(answer(204));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = await mount();
    buttonNamed(host, /Stop sharing/)!.click();
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Sign in/);
    expect((await stored()).CALENDAR_SYNC_TOKEN).toBe("live-link");
  });
});

describe("the feed upload after a stop elsewhere", () => {
  const exam = {
    id: 7,
    name: "Exam",
    kind: "exam",
    begin_at: "2026-10-01T08:00:00.000Z",
    end_at: "2026-10-01T11:00:00.000Z",
  };

  it("a 410 (every link of the login stopped) forgets the dead link", async () => {
    vi.stubGlobal("fetch", vi.fn(answer(410)));
    await syncCalendarIcs([exam], true);
    expect(await stored()).toEqual({});
  });

  it("a 410 keeps a link generated while the upload was on its way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Regenerate answered first: the new link is live
        await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: "new-link" });
        return answer(410)();
      }),
    );
    await syncCalendarIcs([exam], true);
    expect((await stored()).CALENDAR_SYNC_TOKEN).toBe("new-link");
  });

  it("any other failure keeps it: the next visit tries again", async () => {
    vi.stubGlobal("fetch", vi.fn(answer(500)));
    await syncCalendarIcs([exam], true);
    expect(await stored()).toEqual({ CALENDAR_SYNC_TOKEN: "live-link", CALENDAR_EVENTS_HASH: "123" });
  });
});
