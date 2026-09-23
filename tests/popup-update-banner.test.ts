/**
 * The popup's update banner: shown by the self-hosted builds when the
 * background found a newer GitHub release, never by the Chrome Web Store
 * build, whose "Download" would lead store users to side-load a second copy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderUpdateBanner, STORE_BUILD } from "../src/popup/update-banner.ts";
import { UPDATE_KEY } from "../src/core/update-check.ts";

const setBadgeText = vi.fn(async () => {});

function mount() {
  const parent = document.createElement("div");
  const root = document.createElement("div");
  parent.appendChild(root);
  return { parent, root };
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    [UPDATE_KEY]: {
      version: "9.9.9",
      url: "https://github.com/test/better-intra/releases/tag/v9.9.9",
      checkedAt: 1,
    },
  });
  setBadgeText.mockClear();
  (globalThis as any).chrome.runtime = { getManifest: () => ({ version: "1.0.0" }) };
  (globalThis as any).chrome.action = { setBadgeText };
});

describe("renderUpdateBanner", () => {
  it("self-hosted build: offers the download", async () => {
    const { parent, root } = mount();
    await renderUpdateBanner(root, false);
    const banner = parent.querySelector("#update-banner")!;
    expect(banner.textContent).toContain("9.9.9");
    expect(banner.querySelector("a")!.textContent).toContain("Download");
  });

  it("store build: no banner and no NEW badge, whatever is stored", async () => {
    const { parent, root } = mount();
    await renderUpdateBanner(root, true);
    expect(parent.querySelector("#update-banner")).toBeNull();
    expect(parent.textContent).not.toContain("Download");
    expect(setBadgeText).toHaveBeenCalledWith({ text: "" });
  });

  it("follows the build flag by default (not the store build under test)", async () => {
    expect(STORE_BUILD).toBe(false);
    const { parent, root } = mount();
    await renderUpdateBanner(root);
    expect(parent.querySelector("#update-banner")).not.toBeNull();
  });
});
