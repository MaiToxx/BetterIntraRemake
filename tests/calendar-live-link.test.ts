/**
 * The Calendar card asks the worker which link is live (GET
 * /api/v1/private/calendar/token -> {"token": <token> | null}). Only the
 * browser that made a link used to know it: a second browser offered
 * Generate, which revoked the link a phone was subscribed to without a word,
 * and a link regenerated or stopped elsewhere kept showing (its uploads still
 * answered 200). An answer that says neither (an older worker's 405, no
 * answer) leaves the card as it was.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render } from "lit-html";

const sync = vi.hoisted(() => ({ maybeSyncCalendar: vi.fn(async () => {}) }));
vi.mock("../src/features/calendar/calendar-sync.ts", () => sync);
// the QR code draws on a canvas, which jsdom has not
vi.mock("../src/features/calendar/qr.ts", () => ({ generateQrDataUrl: () => "data:," }));

import { renderCalendarPanel, liveLinkIn } from "../src/features/calendar/calendar.ui.ts";
import { renderTabsContent } from "../src/features/hub/controls/tab-panel.ts";
import { hashedLogin, type WorkerResult } from "../src/core/worker.ts";

const TOKEN_PATH = "/api/v1/private/calendar/token";
const OLD = "11111111-1111-4111-8111-111111111111";
const LIVE = "22222222-2222-4222-8222-222222222222";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Answer = () => Response | Promise<Response>;

/** The worker: the GET of the live link gets `live`, anything else `other`. */
function stubWorker(live: Answer, other: (init: RequestInit) => Response | Promise<Response> = () => json(200, {})) {
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const isGet = (init.method ?? "GET") === "GET" && new URL(url).pathname === TOKEN_PATH;
    return isGet ? live() : other(init);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const gets = (fetch: ReturnType<typeof stubWorker>) =>
  fetch.mock.calls.filter(
    ([url, init]) => (init?.method ?? "GET") === "GET" && new URL(url).pathname === TOKEN_PATH,
  );
const sent = (fetch: ReturnType<typeof stubWorker>) =>
  fetch.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET");

/** A GET answer held until the test lets it go. */
function held() {
  let release!: (res: Response) => void;
  const answer = new Promise<Response>((r) => (release = r));
  return { answer: () => answer, release };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

function mountNow(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(renderCalendarPanel(), host);
  return host;
}

/** Mounted, and past the check of the live link. */
async function mount(fetch: ReturnType<typeof stubWorker>): Promise<HTMLElement> {
  const host = mountNow();
  await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
  await settle();
  await vi.waitFor(() => expect(host.querySelector('[aria-busy="true"]')).toBeNull());
  return host;
}

const buttonNamed = (root: ParentNode, text: RegExp) =>
  [...root.querySelectorAll("button")].find((b) => text.test(b.textContent ?? ""));

const stored = async () => chrome.storage.local.get(["CALENDAR_SYNC_TOKEN", "CALENDAR_EVENTS_HASH"]);

const HINT = /If you already made a link in another browser/;

beforeAll(() => {
  // the hub's cards panel listens for storage changes
  const storage = chrome.storage as unknown as { onChanged?: unknown };
  storage.onChanged ??= { addListener: vi.fn(), removeListener: vi.fn() };
});

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CLOUD_LOGIN: "alice" });
  document.body.replaceChildren();
  sessionStorage.clear();
  sync.maybeSyncCalendar.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the live link, asked when the card opens", () => {
  it("a browser without a link takes the live one instead of offering Generate", async () => {
    await chrome.storage.local.set({ CALENDAR_EVENTS_HASH: "stale" });
    const fetch = stubWorker(() => json(200, { token: LIVE }));
    const host = await mount(fetch);
    await vi.waitFor(async () => expect((await stored()).CALENDAR_SYNC_TOKEN).toBe(LIVE));

    const [url, init] = gets(fetch)[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("login")).toBe(await hashedLogin("alice"));
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sess");

    await settle();
    expect(host.textContent).toContain(`/calendar/${LIVE}.ics`);
    expect(buttonNamed(host, /Generate calendar link/)).toBeUndefined();
    expect(buttonNamed(host, /Regenerate/)).toBeDefined();
    // the feed is per login: forgetting the hash uploads it at the next profile visit
    expect((await stored()).CALENDAR_EVENTS_HASH).toBeUndefined();
    expect(sync.maybeSyncCalendar).toHaveBeenCalledTimes(1);
    expect(sent(fetch)).toHaveLength(0);
  });

  it("a link replaced in another browser is replaced here too, and said", async () => {
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: OLD, CALENDAR_EVENTS_HASH: "123" });
    const fetch = stubWorker(() => json(200, { token: LIVE }));
    const host = await mount(fetch);
    await vi.waitFor(() => expect(host.textContent).toContain(`/calendar/${LIVE}.ics`));
    expect(host.textContent).not.toContain(OLD);
    expect(host.textContent).toContain("The link was replaced in another browser: this is the new one.");
    // a status line, there before the answer, so that screen readers say it
    const statuses = [...host.querySelectorAll('[role="status"]')].map((s) => s.textContent!.trim());
    expect(statuses).toContain("The link was replaced in another browser: this is the new one.");
    expect(await stored()).toEqual({ CALENDAR_SYNC_TOKEN: LIVE });
    const links = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(links.every((href) => !href.includes(OLD))).toBe(true);
  });

  it("a link stopped in another browser is forgotten, and said; Generate comes back without the hint", async () => {
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: OLD, CALENDAR_EVENTS_HASH: "123" });
    const fetch = stubWorker(() => json(200, { token: null }));
    const host = await mount(fetch);
    await vi.waitFor(async () => expect(await stored()).toEqual({}));
    await settle();
    expect(host.textContent).toContain("Sharing was stopped from another browser.");
    expect(host.textContent).not.toContain(OLD);
    const generate = buttonNamed(host, /Generate calendar link/)!;
    expect(generate.disabled).toBe(false);
    expect(host.textContent).not.toMatch(HINT);
    expect(sent(fetch)).toHaveLength(0);
  });

  it("no live link anywhere: Generate, without the hint, and the notice goes once a link is made", async () => {
    const fetch = stubWorker(() => json(200, { token: null }));
    const host = await mount(fetch);
    const generate = buttonNamed(host, /Generate calendar link/)!;
    expect(generate.disabled).toBe(false);
    expect(host.textContent).not.toMatch(HINT);
    expect(host.textContent).not.toContain("another browser");
    generate.click();
    await vi.waitFor(async () => expect((await stored()).CALENDAR_SYNC_TOKEN).toBeTypeOf("string"));
    expect(sent(fetch)).toHaveLength(1);
  });

  it("the same link: nothing changes, nothing is uploaded", async () => {
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: LIVE, CALENDAR_EVENTS_HASH: "123" });
    const fetch = stubWorker(() => json(200, { token: LIVE }));
    const host = await mount(fetch);
    await settle();
    expect(await stored()).toEqual({ CALENDAR_SYNC_TOKEN: LIVE, CALENDAR_EVENTS_HASH: "123" });
    expect(host.textContent).not.toContain("another browser");
    expect(sync.maybeSyncCalendar).not.toHaveBeenCalled();
  });

  it("Generate waits for the answer: it cannot revoke a link the worker has not named yet", async () => {
    const get = held();
    const fetch = stubWorker(get.answer);
    const host = mountNow();
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
    await settle();
    const waiting = buttonNamed(host, /Generate calendar link/)!;
    expect(waiting.disabled).toBe(true);
    expect(waiting.getAttribute("aria-busy")).toBe("true");
    waiting.click();
    await settle();
    expect(sent(fetch)).toHaveLength(0);

    get.release(json(200, { token: null }));
    await vi.waitFor(() => expect(buttonNamed(host, /Generate calendar link/)!.disabled).toBe(false));
    expect(buttonNamed(host, /Generate calendar link/)!.getAttribute("aria-busy")).toBe("false");
  });

  it.each([
    ["an older worker (405)", () => json(405, { error: "method_not_allowed" })],
    ["a worker without the route (404)", () => new Response("Not found", { status: 404 })],
    ["a refused session (401)", () => json(401, { error: "unauthorized", message: "Unauthorized" })],
    ["a server error", () => json(500, { error: "server_error" })],
    ["no answer", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a body without token", () => json(200, {})],
    ["a token that is not URL-safe", () => json(200, { token: "../../evil?x=1" })],
  ] as [string, Answer][])("%s: the card stays as this browser knows it", async (_name, answer) => {
    // without a link: Generate, with the hint that it replaces one made elsewhere
    const fetch = stubWorker(answer);
    const host = await mount(fetch);
    expect(buttonNamed(host, /Generate calendar link/)!.disabled).toBe(false);
    expect(host.textContent).toMatch(HINT);
    expect(await stored()).toEqual({});

    // with a link: kept
    document.body.replaceChildren();
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: OLD, CALENDAR_EVENTS_HASH: "123" });
    const again = stubWorker(answer);
    const second = await mount(again);
    await settle();
    expect(second.textContent).toContain(`/calendar/${OLD}.ics`);
    expect(await stored()).toEqual({ CALENDAR_SYNC_TOKEN: OLD, CALENDAR_EVENTS_HASH: "123" });
    expect(second.textContent).not.toContain("another browser");
  });

  it("signed out, nothing is asked", async () => {
    await chrome.storage.local.remove("CLOUD_TOKEN");
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: OLD });
    const fetch = stubWorker(() => json(200, { token: null }));
    const host = mountNow();
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain(`/calendar/${OLD}.ics`);
  });
});

describe("an answer that crosses a change made here is dropped", () => {
  it("a Regenerate sent while the check was on its way", async () => {
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: OLD });
    const get = held();
    let releasePost!: () => void;
    const fetch = stubWorker(get.answer, async () => {
      await new Promise<void>((r) => (releasePost = r));
      return json(200, {});
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = mountNow();
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
    await settle();
    buttonNamed(host, /Regenerate/)!.click();
    await vi.waitFor(() => expect(sent(fetch)).toHaveLength(1));

    // asked before the Regenerate: "no live link" is about the old one
    get.release(json(200, { token: null }));
    await settle();
    expect((await stored()).CALENDAR_SYNC_TOKEN).toBe(OLD);
    expect(host.textContent).not.toContain("Sharing was stopped from another browser.");

    releasePost();
    await vi.waitFor(async () => {
      const token = (await stored()).CALENDAR_SYNC_TOKEN;
      expect(token).toBeTypeOf("string");
      expect(token).not.toBe(OLD);
    });
  });

  it("a Stop sent while the check was on its way", async () => {
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: OLD, CALENDAR_EVENTS_HASH: "123" });
    const get = held();
    let releaseDelete!: () => void;
    const fetch = stubWorker(get.answer, async (init) => {
      if (init.method !== "DELETE") return new Response("Saved", { status: 200 });
      await new Promise<void>((r) => (releaseDelete = r));
      return new Response(null, { status: 204 });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const host = mountNow();
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
    await settle();
    buttonNamed(host, /Stop sharing/)!.click();
    await vi.waitFor(() => expect(sent(fetch)).toHaveLength(1));

    get.release(json(200, { token: LIVE }));
    await settle();
    expect((await stored()).CALENDAR_SYNC_TOKEN).toBe(OLD);
    expect(host.textContent).not.toContain("replaced in another browser");

    releaseDelete();
    await vi.waitFor(async () => expect(await stored()).toEqual({}));
    await settle();
    expect(host.textContent).not.toContain(LIVE);
  });

  it("a link another tab stored meanwhile", async () => {
    const get = held();
    const fetch = stubWorker(get.answer);
    mountNow();
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: LIVE });
    get.release(json(200, { token: null }));
    await settle();
    expect((await stored()).CALENDAR_SYNC_TOKEN).toBe(LIVE);
  });
});

describe("in the hub", () => {
  function renderHub(initialTab: "profile" | "calendar", parent: HTMLElement = document.body) {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    render(
      renderTabsContent(["logtime"], { disabled: new Set(), hidden: new Set() }, { campuses: [], eventTypes: [] }, initialTab),
      shadow,
    );
    parent.appendChild(host);
    return shadow;
  }

  /** The hub's <dialog> (hubSettings.ui.ts): one per page, shown again as it is. */
  function hubDialog() {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    const reopen = async () => {
      dialog.removeAttribute("open");
      await settle();
      dialog.setAttribute("open", "");
      await settle();
    };
    return { dialog, reopen };
  }

  const select = (shadow: ShadowRoot, id: string) => {
    const tab = shadow.querySelector<HTMLInputElement>(`input[name="hub_tabs"][value="${id}"]`)!;
    tab.checked = true;
    tab.dispatchEvent(new Event("change", { bubbles: true }));
  };

  it("asks when the Calendar tab is shown, and again each time, not on every opening of the hub", async () => {
    const fetch = stubWorker(() => json(200, { token: null }));
    const shadow = renderHub("profile");
    await settle();
    expect(gets(fetch)).toHaveLength(0);

    select(shadow, "calendar");
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
    await settle();
    select(shadow, "profile");
    await settle();
    expect(gets(fetch)).toHaveLength(1);
    select(shadow, "calendar");
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(2));

    // a hub drawn again leaves this panel behind: it no longer asks
    await settle();
    shadow.host.remove();
    select(shadow, "calendar");
    await settle();
    expect(gets(fetch)).toHaveLength(2);
  });

  it("asks again when the hub is opened again on the Calendar tab, not on another tab", async () => {
    const fetch = stubWorker(() => json(200, { token: null }));
    const { dialog, reopen } = hubDialog();
    const shadow = renderHub("calendar", dialog);
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
    await settle();

    await reopen();
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(2));

    select(shadow, "profile");
    await settle();
    await reopen();
    expect(gets(fetch)).toHaveLength(2);

    // closing it asks nothing
    dialog.removeAttribute("open");
    select(shadow, "calendar");
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(3));
    await settle();
    await settle();
    expect(gets(fetch)).toHaveLength(3);
  });

  it("no check starts while a Stop or a Regenerate is on its way", async () => {
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: OLD, CALENDAR_EVENTS_HASH: "123" });
    let token: string | null = OLD;
    const releases: (() => void)[] = [];
    const fetch = stubWorker(
      () => json(200, { token }),
      async (init) => {
        if (init.method === "DELETE") {
          await new Promise<void>((r) => releases.push(r));
          token = null;
          return new Response(null, { status: 204 });
        }
        if (init.method === "POST" && !/CALENDAR_SYNC_TOKEN/.test(String(init.body))) {
          await new Promise<void>((r) => releases.push(r));
          token = JSON.parse(String(init.body)).token;
          return json(200, {});
        }
        return new Response("Saved", { status: 200 });
      },
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const shadow = renderHub("calendar");
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
    await settle();

    // Regenerate on its way: a check answered before it would name the old link
    buttonNamed(shadow, /Regenerate/)!.click();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    select(shadow, "profile");
    select(shadow, "calendar");
    await settle();
    expect(gets(fetch)).toHaveLength(1);
    releases.shift()!();
    await vi.waitFor(async () => expect((await stored()).CALENDAR_SYNC_TOKEN).not.toBe(OLD));
    const made = (await stored()).CALENDAR_SYNC_TOKEN;
    await settle();

    // Stop on its way: a check answered "no link" would bring Generate back
    // while the stop is not through
    buttonNamed(shadow, /Stop sharing/)!.click();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    select(shadow, "profile");
    select(shadow, "calendar");
    await settle();
    expect(gets(fetch)).toHaveLength(1);
    expect(buttonNamed(shadow, /Generate calendar link/)).toBeUndefined();
    expect((await stored()).CALENDAR_SYNC_TOKEN).toBe(made);
    releases.shift()!();
    await vi.waitFor(async () => expect(await stored()).toEqual({}));
    await settle();
    expect(shadow.textContent).not.toContain("another browser:");
    expect(shadow.textContent).not.toContain("Sharing was stopped from another browser.");

    // and once they are through, the tab asks again
    select(shadow, "profile");
    select(shadow, "calendar");
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(2));
  });

  it("a stop said by an earlier check does not stay above a link made later elsewhere", async () => {
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: OLD, CALENDAR_EVENTS_HASH: "123" });
    const answers: (string | null)[] = [null, LIVE];
    const fetch = stubWorker(() => json(200, { token: answers.shift() ?? null }));
    const shadow = renderHub("calendar");
    await vi.waitFor(() => expect(shadow.textContent).toContain("Sharing was stopped from another browser."));
    await settle();

    select(shadow, "profile");
    select(shadow, "calendar");
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(2));
    await vi.waitFor(() => expect(shadow.textContent).toContain(`/calendar/${LIVE}.ics`));
    await settle();
    expect(shadow.textContent).not.toContain("Sharing was stopped from another browser.");
    // no link was here to be replaced
    expect(shadow.textContent).not.toContain("replaced in another browser");
  });

  it("asks at once when the hub opens on the Calendar tab", async () => {
    const fetch = stubWorker(() => json(200, { token: LIVE }));
    const shadow = renderHub("calendar");
    await vi.waitFor(() => expect(gets(fetch)).toHaveLength(1));
    await vi.waitFor(() => expect(shadow.textContent).toContain(`/calendar/${LIVE}.ics`));
  });
});

describe("liveLinkIn", () => {
  const res = (ok: boolean, json: unknown): WorkerResult => ({
    ok,
    status: ok ? 200 : 500,
    json,
    text: "",
    timedOut: false,
  });

  it("reads a token, null, or nothing", () => {
    expect(liveLinkIn(res(true, { token: LIVE }))).toBe(LIVE);
    expect(liveLinkIn(res(true, { token: null }))).toBeNull();
    expect(liveLinkIn(res(true, {}))).toBeUndefined();
    expect(liveLinkIn(res(true, null))).toBeUndefined();
    expect(liveLinkIn(res(false, { token: LIVE }))).toBeUndefined();
    expect(liveLinkIn(res(true, { token: "short" }))).toBeUndefined();
    expect(liveLinkIn(res(true, { token: "a/b?c=d&e" }))).toBeUndefined();
    expect(liveLinkIn(res(true, { token: 42 }))).toBeUndefined();
  });
});
