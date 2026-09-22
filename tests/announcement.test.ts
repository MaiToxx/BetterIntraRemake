import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  initAnnouncementBanner,
  announcementId,
  CACHE_KEY,
  DISMISSED_KEY,
} from "../src/features/announcement/announcement";

const BANNER = "#ft-announcement-banner";
const payload = (message: string) => ({
  message,
  updatedAt: 1,
  level: "warning",
  links: [{ text: "More", url: "https://example.test/more" }],
});

/** A new tab: fresh document and sessionStorage, the same extension storage. */
function newTab() {
  document.body.replaceChildren();
  sessionStorage.clear();
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  Object.defineProperty(window, "location", {
    value: new URL("https://profile-v3.intra.42.fr/"),
    writable: true,
    configurable: true,
  });
  await chrome.storage.local.clear();
  newTab();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload("Maintenance tonight") }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("announcement banner", () => {
  it("shows the worker's announcement with its links", async () => {
    await initAnnouncementBanner();
    const banner = document.querySelector(BANNER);
    expect(banner?.textContent).toContain("Maintenance tonight");
    expect(banner?.querySelector("a")?.getAttribute("href")).toBe("https://example.test/more");
  });

  it("stays dismissed in a new tab and after a restart", async () => {
    await initAnnouncementBanner();
    (document.querySelector(`${BANNER} button`) as HTMLButtonElement).click();
    expect(document.querySelector(BANNER)).toBeNull();
    const stored = await chrome.storage.local.get(DISMISSED_KEY);
    expect(stored[DISMISSED_KEY]).toBe(announcementId("Maintenance tonight", "warning", payload("").links));

    newTab();
    await initAnnouncementBanner();
    expect(document.querySelector(BANNER)).toBeNull();

    // A restart: the 5-minute cache is gone, the dismissal is not.
    await chrome.storage.local.remove(CACHE_KEY);
    newTab();
    await initAnnouncementBanner();
    expect(document.querySelector(BANNER)).toBeNull();
  });

  it("shows a re-worded announcement again", async () => {
    await initAnnouncementBanner();
    (document.querySelector(`${BANNER} button`) as HTMLButtonElement).click();

    await chrome.storage.local.remove(CACHE_KEY);
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => payload("Maintenance postponed") }));
    newTab();
    await initAnnouncementBanner();
    expect(document.querySelector(BANNER)?.textContent).toContain("Maintenance postponed");
  });

  it("all tabs share one request per cache period", async () => {
    await initAnnouncementBanner();
    newTab();
    await initAnnouncementBanner();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector(BANNER)).not.toBeNull();
  });

  it("does nothing off the profile hosts", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://projects.intra.42.fr/"),
      writable: true,
      configurable: true,
    });
    await initAnnouncementBanner();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
