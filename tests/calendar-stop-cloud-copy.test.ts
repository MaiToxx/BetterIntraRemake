/**
 * Stop sharing also empties the calendar link in the cloud copy of the
 * settings (another browser would restore the revoked link from it), and
 * nothing else: it used to run a whole push, which uploaded every setting of
 * a student who chose Manual push, on the click meant to take their data off
 * the server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "lit-html";

// the QR code draws on a canvas, which jsdom has not
vi.mock("../src/features/calendar/qr.ts", () => ({ generateQrDataUrl: () => "data:," }));

import { renderCalendarPanel } from "../src/features/calendar/calendar.ui.ts";
import { forgetCloudCalendarLink } from "../src/features/account/account.ts";

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  calls = [];
  document.body.replaceChildren();
  vi.restoreAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    CLOUD_TOKEN: "sess",
    CLOUD_LOGIN: "alice",
    CALENDAR_SYNC_TOKEN: "live-link",
    CALENDAR_EVENTS_HASH: "123",
    // settings the student never pushed
    FRIENDS_LIST: ["bob", "carol"],
    CUSTOM_CSS: "body { color: hotpink }",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        method: init.method ?? "GET",
        path: new URL(url).pathname,
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      return init.method === "DELETE"
        ? new Response(null, { status: 204 })
        : new Response("Saved", { status: 200 });
    }),
  );
});

const settingsPosts = () =>
  calls.filter((c) => c.method === "POST" && c.path === "/api/v1/private/settings");

describe("the cloud copy after Stop sharing", () => {
  it("loses the calendar link, and receives no other setting", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(renderCalendarPanel(), host);
    await settle();
    [...host.querySelectorAll("button")].find((b) => /Stop sharing/.test(b.textContent ?? ""))!.click();

    await vi.waitFor(() => expect(settingsPosts()).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/api/v1/private/calendar/token" });
    expect(settingsPosts()[0].body).toEqual({
      settings: { CALENDAR_SYNC_TOKEN: "", CALENDAR_EVENTS_HASH: "" },
    });
  });

  it("is cleared even while the restore question is open: it only removes a dead link", async () => {
    await chrome.storage.local.set({ PENDING_SETTINGS_RESTORE: true });
    await forgetCloudCalendarLink();
    expect(settingsPosts().map((c) => c.body)).toEqual([
      { settings: { CALENDAR_SYNC_TOKEN: "", CALENDAR_EVENTS_HASH: "" } },
    ]);
  });

  it("sends nothing signed out", async () => {
    await chrome.storage.local.remove("CLOUD_TOKEN");
    await forgetCloudCalendarLink();
    expect(calls).toEqual([]);
  });
});
