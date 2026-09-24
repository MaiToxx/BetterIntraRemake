/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The Intra events drawn on the logtime day cells (green border for a
 * subscribed event) used to be passed to renderLogtime() by the one render
 * that follows the events fetch only. Every other re-render (view switcher,
 * header collapse on resize, carousel arrows, a visited user's published
 * settings) called renderLogtime(stats) and drew the calendar without them,
 * until the page was reloaded.
 *
 * One module instance for the whole file: the data listener it installs on
 * `document` cannot be removed, so the steps run in order.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("../src/features/calendar/calendar-sync.ts", () => ({
  syncCalendarIcs: vi.fn(async () => {}),
}));

import {
  initLogtime,
  applyPublicLogtimeSettings,
} from "../src/features/logtime/logtime";

const SUBSCRIBED_BORDER = "rgb(34,197,94)";

let resizeCallbacks: (() => void)[] = [];
let overflowing = false;
/** While set, the events fetch waits for it (a slow Intra API). */
let eventsGate: Promise<void> | null = null;

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 2));
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

const now = new Date();
const today = ymd(now);
const lastMonth = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 10));

function root(): ShadowRoot {
  return document.getElementById("logtime-shadow-wrapper")!.shadowRoot!;
}

/** Day cells drawn with the "subscribed event" border. */
function markedCells(): number {
  return [...root().querySelectorAll<HTMLElement>(".day-cell")].filter((c) =>
    (c.getAttribute("style") || "").includes(SUBSCRIBED_BORDER),
  ).length;
}

function viewButton(label: string): HTMLButtonElement {
  const btn = [
    ...root().querySelectorAll<HTMLButtonElement>(".lt-view-join button"),
  ].find((b) => b.dataset.tip === label);
  if (!btn) throw new Error(`no ${label} button`);
  return btn;
}

function sendStats() {
  document.dispatchEvent(
    new CustomEvent("42_LOGTIME_DATA", {
      detail: { [lastMonth]: "01:00:00", [today]: "03:00:00" },
    }),
  );
}

beforeAll(async () => {
  // Captures the header observer so a test can play a window resize.
  (globalThis as any).ResizeObserver = class {
    constructor(cb: () => void) {
      resizeCallbacks.push(cb);
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  // measureHeaderOverflow() reads layout that jsdom does not compute: give the
  // header a width and every part of it a size, switched by `overflowing`.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 300;
    },
  });
  Element.prototype.getBoundingClientRect = function () {
    const width = overflowing ? 200 : 10;
    return { width, height: 10, top: 0, left: 0, right: width, bottom: 10, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };

  await chrome.storage.local.set({
    CLOUD_LOGIN: "me",
    LOGTIME_CALENDAR_VIEW: "normal",
  });
  sessionStorage.setItem("ft_intrapy_token", "Bearer x");
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/users/me/events")) {
      if (eventsGate) await eventsGate;
      return new Response(
        JSON.stringify({
          "1": {
            id: 1,
            name: "Exam",
            kind: "exam",
            begin_at: now.toISOString(),
            end_at: now.toISOString(),
            location: "",
            is_subscribed: true,
          },
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  });

  // The legacy logtime card the widget mounts next to.
  const grid = document.createElement("div");
  const card = document.createElement("div");
  card.className = "bg-white md:h-96";
  card.textContent = "LOGTIME";
  grid.appendChild(card);
  document.body.appendChild(grid);

  await initLogtime();
});

describe("logtime event markers survive re-renders", () => {
  // A fresh page load before each step (hook payload, then the events fetch),
  // so that every re-render path is checked on its own.
  beforeEach(async () => {
    sendStats();
    await flush();
  });

  it("draws the subscribed event after the events fetch", () => {
    expect(markedCells()).toBe(1);
  });

  it("keeps them after a view switch", async () => {
    viewButton("Compact").click();
    await flush();
    expect(markedCells()).toBe(1);
    viewButton("Normal").click();
    await flush();
    expect(markedCells()).toBe(1);
  });

  it("keeps them after the header collapses on resize", async () => {
    overflowing = true;
    for (const cb of resizeCallbacks) cb();
    await flush();
    expect(root().querySelector(".lt-view-switcher.collapsed")).toBeTruthy();
    expect(markedCells()).toBe(1);
    overflowing = false;
    for (const cb of resizeCallbacks) cb();
    await flush();
    expect(markedCells()).toBe(1);
  });

  it("keeps them while navigating the carousel", async () => {
    viewButton("Carousel").click();
    await flush();
    expect(markedCells()).toBe(1);
    const [prev, next] = root().querySelectorAll<HTMLButtonElement>(
      ".lt-carousel-arrow",
    );
    prev.click();
    await flush();
    expect(markedCells()).toBe(0); // last month has no event
    next.click();
    await flush();
    expect(markedCells()).toBe(1);
  });

  it("keeps them when published settings re-render the widget", async () => {
    applyPublicLogtimeSettings({ calendarColor: "#112233" });
    await flush();
    expect(markedCells()).toBe(1);
  });
});

describe("logtime event markers on another profile", () => {
  it("never draws your events on another student's calendar", async () => {
    history.pushState({}, "", "/users/bob");
    sendStats();
    await flush();
    expect(markedCells()).toBe(0);
    viewButton("Compact").click();
    await flush();
    expect(markedCells()).toBe(0);
    viewButton("Normal").click();
    await flush();
  });

  it("keeps them off a profile opened while they were loading", async () => {
    let release!: () => void;
    eventsGate = new Promise((r) => (release = r));
    history.pushState({}, "", "/");
    sendStats(); // own profile: the events fetch starts, and waits
    await flush();
    history.pushState({}, "", "/users/bob");
    sendStats(); // bob's calendar is drawn before the events come back
    await flush();
    release();
    eventsGate = null;
    await flush();
    expect(markedCells()).toBe(0);
  });
});

describe("logtime event markers signed out", () => {
  // The events come from the Intra with the page's own token: the markers
  // used to wait for a cloud sign-in (CLOUD_LOGIN) that they never needed,
  // so a student who never signed in saw none.
  it("draws them on your own calendar without a cloud sign-in", async () => {
    await chrome.storage.local.remove("CLOUD_LOGIN");
    history.pushState({}, "", "/");
    sendStats();
    await flush();
    expect(markedCells()).toBe(1);
  });
});

describe("the records badge on a full header", () => {
  // Same widget, other concern: the harness above is the one that plays
  // resizes. The badge (streak) counts in the fold of the view switcher; on
  // a line that is still full once folded (a phone), it steps out of it.
  it("steps out of the folded line when it has no room, and comes back", async () => {
    history.pushState({}, "", "/");
    sendStats();
    await flush();
    expect(root().querySelector(".lt-records-badge")).toBeTruthy();

    overflowing = true; // every part 200px wide in a 300px header
    for (const cb of resizeCallbacks) cb(); // folds the switcher
    await flush();
    for (const cb of resizeCallbacks) cb(); // the re-armed observer's first call
    await flush();
    expect(root().querySelector(".lt-view-switcher.collapsed")).toBeTruthy();
    expect(root().querySelector(".lt-records-badge.lt-records-off")).toBeTruthy();

    overflowing = false;
    for (const cb of resizeCallbacks) cb();
    await flush();
    expect(root().querySelector(".lt-view-switcher.collapsed")).toBeNull();
    expect(root().querySelector(".lt-records-off")).toBeNull();
    expect(root().querySelector(".lt-records-badge")).toBeTruthy();
  });
});
