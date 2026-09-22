/**
 * The calendar strip turns the wheel into horizontal scrolling. It used to
 * swallow every wheel event, so with the pointer over the calendar the page
 * could not be scrolled at all, even once the strip had reached an end.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupScrollHandlers } from "../src/features/logtime/dom";

function strip(scrollLeft: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollWidth", { value: 1000, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
  let left = scrollLeft;
  Object.defineProperty(el, "scrollLeft", {
    get: () => left,
    set: (v: number) => {
      left = v;
    },
    configurable: true,
  });
  setupScrollHandlers(el);
  return el;
}

function wheel(el: HTMLElement, deltaY: number, deltaX = 0): WheelEvent {
  const e = new WheelEvent("wheel", { deltaY, deltaX, cancelable: true, bubbles: true });
  el.dispatchEvent(e);
  return e;
}

describe("logtime wheel handler", () => {
  let el: HTMLElement;
  beforeEach(() => {
    el = strip(300);
  });

  it("scrolls the strip while it can still move", () => {
    expect(wheel(el, 50).defaultPrevented).toBe(true);
    expect(el.scrollLeft).toBe(350);
    expect(wheel(el, -50).defaultPrevented).toBe(true);
    expect(el.scrollLeft).toBe(300);
  });

  it("lets the page scroll at the right end", () => {
    const end = strip(600);
    expect(wheel(end, 50).defaultPrevented).toBe(false);
    expect(end.scrollLeft).toBe(600);
  });

  it("lets the page scroll at the left end", () => {
    const start = strip(0);
    expect(wheel(start, -50).defaultPrevented).toBe(false);
    expect(start.scrollLeft).toBe(0);
  });

  it("leaves a trackpad's horizontal swipe to the native overflow", () => {
    expect(wheel(el, 2, 40).defaultPrevented).toBe(false);
    expect(el.scrollLeft).toBe(300);
  });
});
