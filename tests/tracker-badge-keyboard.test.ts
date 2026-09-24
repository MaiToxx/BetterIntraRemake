/**
 * The Phoenix/Pegasus badge's popover opened on hover only, and it is the
 * one place to choose your phase: keyboard users could do neither. The
 * badge is now a button (Enter, Space, click), the popover takes the focus
 * when opened from the keyboard, Escape gives it back, and focus leaving
 * both closes it. The popover also says what is left of the week.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// Wednesday 23 September 2026: the tracked week began on Saturday the 19th.
vi.mock("../src/features/logtime/logtime.ts", () => ({
  lastStats: {
    "2026-09-19": "05:00:00",
    "2026-09-21": "08:00:00",
    "2026-09-22": "08:30:00",
  },
}));

import { colorTrackerBadge } from "../src/features/logtime/tracker-card";

let badge: HTMLElement;
let elsewhere: HTMLButtonElement;

/** The popover's host, once it has rendered. */
function popover(): HTMLElement | undefined {
  return [...document.body.children].find(
    (el): el is HTMLElement => el instanceof HTMLElement && !!el.shadowRoot?.querySelector(".ft-popover"),
  );
}

const key = (target: Element, k: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, composed: true, cancelable: true }));

/**
 * A mouse press, focus-wise, as a browser does it (jsdom moves no focus on
 * a click): the nearest focusable ancestor takes the focus, or the focused
 * element loses it to the page.
 */
function press(target: Element) {
  for (let el: Element | null = target; el; ) {
    if (el instanceof HTMLElement && (el.hasAttribute("tabindex") || el.matches("select, button"))) {
      el.focus();
      return;
    }
    el = el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null);
  }
  let active = document.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement as HTMLElement;
  active?.blur();
}

/** The popover's "Saturday to Friday" note: plain text, nothing focusable. */
const popoverNote = () =>
  [...popover()!.shadowRoot!.querySelectorAll("p")].find((p) => p.textContent!.includes("Saturday to Friday"))!;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 23, 19, 0));
  await chrome.storage.local.set({ TRACKER_MODE: "pegasus-gold" });
  // the Intra's own badge, found by its classes and its text
  badge = document.createElement("div");
  badge.className = "inline-flex items-center rounded border";
  badge.textContent = "Pegasus";
  elsewhere = document.createElement("button");
  elsewhere.textContent = "elsewhere";
  document.body.append(badge, elsewhere);
  await colorTrackerBadge();
});

afterEach(async () => {
  elsewhere.focus();
  await vi.waitFor(() => expect(popover()).toBeUndefined());
});

describe("tracker badge", () => {
  it("is a button for the keyboard and assistive tech", () => {
    expect(badge.getAttribute("role")).toBe("button");
    expect(badge.tabIndex).toBe(0);
    expect(badge.getAttribute("aria-haspopup")).toBe("dialog");
    expect(badge.getAttribute("aria-expanded")).toBe("false");
  });

  it("Enter opens the popover on the phase selector; Escape closes it and gives the focus back", async () => {
    badge.focus();
    key(badge, "Enter");
    await vi.waitFor(() => {
      const select = popover()?.shadowRoot?.querySelector("select");
      expect(select).toBeTruthy();
      expect(popover()!.shadowRoot!.activeElement).toBe(select);
    });
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    expect(popover()!.shadowRoot!.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe("Pegasus - Gold");

    key(popover()!.shadowRoot!.querySelector("select")!, "Escape");
    expect(popover()).toBeUndefined();
    expect(document.activeElement).toBe(badge);
    expect(badge.getAttribute("aria-expanded")).toBe("false");
  });

  it("says what is left of the week, and how the week is counted", async () => {
    badge.focus();
    key(badge, " ");
    await vi.waitFor(() => expect(popover()).toBeDefined());
    const text = popover()!.shadowRoot!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("21h30/40h");
    expect(text).toContain("18h30 left · 6h10/day for 3 days (today included)");
    expect(text).toContain("2 more days with logtime to go");
    expect(text).toContain("Saturday to Friday, 12h max counted per day");
    expect(text).not.toContain("Out of reach this week");
  });

  it("focus leaving both the badge and the popover closes it", async () => {
    badge.focus();
    key(badge, "Enter");
    await vi.waitFor(() => expect(popover()?.shadowRoot?.activeElement).toBeTruthy());
    elsewhere.focus();
    expect(popover()).toBeUndefined();
    expect(badge.getAttribute("aria-expanded")).toBe("false");
  });

  it("hover still opens it; the pointer leaving closes it unless it holds the focus", async () => {
    badge.dispatchEvent(new MouseEvent("mouseenter"));
    await vi.waitFor(() => expect(popover()).toBeDefined());
    badge.dispatchEvent(new MouseEvent("mouseleave"));
    await vi.waitFor(() => expect(popover()).toBeUndefined());

    badge.focus();
    key(badge, "Enter");
    await vi.waitFor(() => expect(popover()?.shadowRoot?.activeElement).toBeTruthy());
    popover()!.dispatchEvent(new MouseEvent("mouseleave"));
    await new Promise((r) => setTimeout(r, 150));
    expect(popover()).toBeDefined();
  });

  it("names the phase selector it puts the focus on", async () => {
    badge.focus();
    key(badge, "Enter");
    await vi.waitFor(() => expect(popover()?.shadowRoot?.querySelector("select")).toBeTruthy());
    expect(popover()!.shadowRoot!.querySelector("select")!.getAttribute("aria-label")).toBe("Weekly goal");
  });

  it("a click on the popover's text keeps it open, the focus inside it", async () => {
    // opened from the keyboard: the select holds the focus
    badge.focus();
    key(badge, "Enter");
    await vi.waitFor(() => expect(popover()?.shadowRoot?.activeElement).toBeTruthy());
    press(popoverNote());
    expect(popover()).toBeDefined();
    expect(popover()!.shadowRoot!.activeElement!.getAttribute("role")).toBe("dialog");

    // opened by a click on the badge, which then holds the focus
    elsewhere.focus();
    await vi.waitFor(() => expect(popover()).toBeUndefined());
    press(badge);
    badge.click();
    await vi.waitFor(() => expect(popover()).toBeDefined());
    press(popoverNote());
    expect(popover()).toBeDefined();
    // and it still closes when the focus goes elsewhere
    press(elsewhere);
    expect(popover()).toBeUndefined();
  });

  it("Tab out of the popover goes back to the badge, not to the end of the page", async () => {
    badge.focus();
    key(badge, "Enter");
    await vi.waitFor(() => expect(popover()?.shadowRoot?.activeElement).toBeTruthy());
    // not prevented: the browser moves on from the badge
    expect(key(popover()!.shadowRoot!.querySelector("select")!, "Tab")).toBe(true);
    expect(popover()).toBeUndefined();
    expect(document.activeElement).toBe(badge);

    key(badge, "Enter");
    await vi.waitFor(() => expect(popover()?.shadowRoot?.activeElement).toBeTruthy());
    // prevented: Shift+Tab stops on the badge
    expect(key(popover()!.shadowRoot!.querySelector("select")!, "Tab", true)).toBe(false);
    expect(popover()).toBeUndefined();
    expect(document.activeElement).toBe(badge);
  });

  it("focus alone does not open it; a click does, and a second click keeps it open", async () => {
    // a mouse press focuses the badge (tabindex), then the click lands
    badge.focus();
    await new Promise((r) => setTimeout(r, 0));
    expect(popover()).toBeUndefined();
    badge.click();
    await vi.waitFor(() => expect(popover()).toBeDefined());
    const first = popover();
    badge.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(popover()).toBe(first);
  });
});
