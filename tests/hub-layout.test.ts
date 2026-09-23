/**
 * The hub's height model in a narrow window. daisyUI sizes the open panel as
 * the tab list minus one row of tabs; the hub's nine tabs wrap below about
 * 1090 px (four rows on a phone), and every extra row pushed the end of each
 * tab out of reach ("Reset all data", the custom CSS box...). The hub now
 * measures the rows and gives the panel the rest. jsdom lays nothing out, so
 * the rows are given here as the browser would report them.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

vi.mock("../src/features/hub/controls/context.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/features/hub/controls/context.ts")>()),
  loadLiveOptions: vi.fn(async () => ({ campuses: [], eventTypes: [] })),
}));

class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  observed: Element[] = [];
  constructor(public callback: ResizeObserverCallback) {
    FakeResizeObserver.last = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeAll(() => {
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
  (window as unknown as { matchMedia: unknown }).matchMedia ??= vi.fn(() => ({ matches: true }));
  const storage = chrome.storage as unknown as { onChanged?: unknown };
  storage.onChanged ??= { addListener: vi.fn(), removeListener: vi.fn() };
});

beforeEach(async () => {
  document.getElementById("hub-dialog")?.remove();
  await chrome.storage.local.clear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeResizeObserver.last = null;
});

async function openHub(): Promise<ShadowRoot> {
  const { openHubModal } = await import("../src/features/hub/hubSettings.ui.ts");
  await openHubModal(["profile", "logtime"]);
  const dialog = document.getElementById("hub-dialog") as HTMLDialogElement;
  const wrapper = dialog.querySelector("#hub-shadow-wrapper")!;
  await vi.waitFor(() => expect(wrapper.shadowRoot?.querySelector('[role="tablist"]')).toBeTruthy(), {
    timeout: 8000,
  });
  return wrapper.shadowRoot!;
}

const rect = (top: number, bottom: number) =>
  ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top }) as DOMRect;

describe("the open panel's height", () => {
  it("is the tab list minus the rows the tabs really take", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const shadow = await openHub();
    const list = shadow.querySelector<HTMLElement>('[role="tablist"]')!;
    const tabs = [...list.children].filter((el): el is HTMLElement => el.matches("label.tab"));
    expect(tabs).toHaveLength(9);
    const observer = FakeResizeObserver.last!;
    // the list and every tab: a search count widening a tab can add a row
    expect(observer.observed).toContain(list);
    for (const tab of tabs) expect(observer.observed).toContain(tab);

    // four rows of 48 px under a list that starts at y = 100
    list.getBoundingClientRect = () => rect(100, 700);
    tabs.forEach((tab, i) => {
      const row = Math.floor(i / 2.25); // 3, 2, 2, 2 tabs a row
      tab.getBoundingClientRect = () => rect(100 + row * 48, 148 + row * 48);
    });
    observer.fire();
    expect(list.style.getPropertyValue("--hub-tabs-h")).toBe("192px");

    // wider window: one row
    tabs.forEach((tab) => (tab.getBoundingClientRect = () => rect(100, 148)));
    observer.fire();
    expect(list.style.getPropertyValue("--hub-tabs-h")).toBe("48px");

    // closed hub: nothing laid out, the last value stays
    list.getBoundingClientRect = () => rect(0, 0);
    tabs.forEach((tab) => (tab.getBoundingClientRect = () => rect(0, 0)));
    observer.fire();
    expect(list.style.getPropertyValue("--hub-tabs-h")).toBe("48px");

    const css = shadow.querySelector("style")!.textContent!;
    expect(css).toMatch(/\.tab-content\s*{[^}]*height:\s*calc\(100% - var\(--hub-tabs-h/);
    // lines packed at the top, or the stretched spare height would be measured
    expect(css).toMatch(/\[role="tablist"\]\s*{[^}]*align-content:\s*flex-start/);
  });

  it("falls back to daisyUI's one-row height where ResizeObserver is missing", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const shadow = await openHub();
    const list = shadow.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(list.style.getPropertyValue("--hub-tabs-h")).toBe("");
    expect(shadow.querySelector("style")!.textContent).toContain(
      "var(--hub-tabs-h, var(--tab-height))",
    );
  });
});

describe("on a phone", () => {
  it("keeps every tab named for screen readers while it shows the icons only", async () => {
    const shadow = await openHub();
    const names = [...shadow.querySelectorAll<HTMLElement>('input[name="hub_tabs"]')].map(
      (tab) => shadow.getElementById(tab.getAttribute("aria-labelledby")!)!,
    );
    expect(names).toHaveLength(9);
    for (const name of names) {
      expect(name.classList.contains("max-sm:sr-only")).toBe(true);
      expect(name.classList.contains("hidden")).toBe(false);
      expect(name.textContent!.trim()).not.toBe("");
    }
  });

  it("gives the search a row of its own instead of the space left by the title", async () => {
    const shadow = await openHub();
    const search = shadow.querySelector("#hub-search")!.parentElement!;
    expect(search.classList.contains("basis-full")).toBe(true);
    expect(search.classList.contains("sm:basis-auto")).toBe(true);
    expect(search.parentElement!.classList.contains("flex-wrap")).toBe(true);
  });
});
