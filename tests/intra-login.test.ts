import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  INTRA_LOGIN_MESSAGE,
  requestIntraLoginFromActiveTab,
} from "../src/features/account/intra-login";

const tabsMock = {
  query: vi.fn(),
  sendMessage: vi.fn(),
  create: vi.fn(async () => ({})),
};

beforeEach(async () => {
  await chrome.storage.local.clear();
  tabsMock.query.mockReset();
  tabsMock.sendMessage.mockReset();
  tabsMock.create.mockClear();
  (globalThis as any).chrome.tabs = tabsMock;
  tabsMock.query.mockResolvedValue([
    { id: 7, url: "https://profile-v3.intra.42.fr/users/alepayen" },
  ]);
});

describe("requestIntraLoginFromActiveTab", () => {
  it("relays the content script answer", async () => {
    tabsMock.sendMessage.mockResolvedValue({ ok: true, login: "alepayen" });
    await expect(requestIntraLoginFromActiveTab()).resolves.toEqual({
      ok: true,
      login: "alepayen",
    });
    expect(tabsMock.sendMessage).toHaveBeenCalledWith(7, { type: INTRA_LOGIN_MESSAGE });
  });

  it("treats a lost answer as success when a new session landed in storage", async () => {
    // the content script stored the session, then its tab was reloaded before
    // sendResponse reached the popup
    tabsMock.sendMessage.mockImplementation(async () => {
      await chrome.storage.local.set({ CLOUD_TOKEN: "new-uuid", CLOUD_LOGIN: "alepayen" });
      throw new Error("Could not establish connection. Receiving end does not exist.");
    });
    await expect(requestIntraLoginFromActiveTab()).resolves.toEqual({
      ok: true,
      login: "alepayen",
    });
  });

  it("recognises a replaced session token as a new login", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "old-uuid", CLOUD_LOGIN: "alepayen" });
    tabsMock.sendMessage.mockImplementation(async () => {
      await chrome.storage.local.set({ CLOUD_TOKEN: "new-uuid", CLOUD_LOGIN: "alepayen" });
      throw new Error("tab reloaded");
    });
    await expect(requestIntraLoginFromActiveTab()).resolves.toEqual({
      ok: true,
      login: "alepayen",
    });
  });

  it("reports the missing content script when storage did not change", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "old-uuid", CLOUD_LOGIN: "alepayen" });
    tabsMock.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));
    const res = await requestIntraLoginFromActiveTab();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not running on this tab/);
  });

  it("reports the missing content script when nothing is stored", async () => {
    tabsMock.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));
    const res = await requestIntraLoginFromActiveTab();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not running on this tab/);
  });

  it("opens the v3 profile when the active tab is not an Intra page", async () => {
    tabsMock.query.mockResolvedValue([{ id: 3, url: "https://example.com/" }]);
    const res = await requestIntraLoginFromActiveTab();
    expect(res.ok).toBe(false);
    expect(tabsMock.create).toHaveBeenCalledWith({ url: "https://profile-v3.intra.42.fr/" });
    expect(tabsMock.sendMessage).not.toHaveBeenCalled();
  });
});
