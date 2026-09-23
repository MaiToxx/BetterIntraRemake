/**
 * The popup's strip about the active tab, and the content script's side of
 * it: "not running on this tab yet" with a Reload that only happens on click,
 * "Open settings" where the hub opens, a way to the v3 profile from a v2 page,
 * and nothing at all when the popup cannot tell (no access yet, loading, an
 * older content script).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  probeTab,
  renderTabStatus,
} from "../src/popup/tab-status.ts";
import {
  answerPopupMessage,
  OPEN_HUB_MESSAGE,
  PING_MESSAGE,
} from "../src/features/account/popup-bridge.ts";

const tabs = {
  sendMessage: vi.fn(),
  reload: vi.fn(),
  create: vi.fn(),
};
const permissions = { contains: vi.fn(async () => true) };
const close = vi.fn();

const V3_TAB = {
  id: 7,
  url: "https://profile-v3.intra.42.fr/users/alice",
  status: "complete",
} as chrome.tabs.Tab;

const NO_RECEIVER = new Error(
  "Could not establish connection. Receiving end does not exist.",
);

beforeEach(() => {
  tabs.sendMessage.mockReset();
  tabs.reload.mockReset();
  tabs.create.mockReset();
  permissions.contains.mockReset();
  permissions.contains.mockResolvedValue(true);
  close.mockReset();
  (globalThis as any).chrome.tabs = tabs;
  (globalThis as any).chrome.permissions = permissions;
  vi.spyOn(window, "close").mockImplementation(close);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeTab", () => {
  it("no content script in the tab: not running", async () => {
    tabs.sendMessage.mockRejectedValue(NO_RECEIVER);
    await expect(probeTab(V3_TAB)).resolves.toBe("not-running");
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, { type: PING_MESSAGE });
  });

  it("the hub opens here, or the page is a v2 one", async () => {
    tabs.sendMessage.mockResolvedValue({ ok: true, hub: true });
    await expect(probeTab(V3_TAB)).resolves.toBe("hub");
    tabs.sendMessage.mockResolvedValue({ ok: true, hub: false });
    await expect(probeTab(V3_TAB)).resolves.toBe("v2");
  });

  it("a content script that does not answer FT_PING is running: no hint", async () => {
    tabs.sendMessage.mockResolvedValue(undefined);
    await expect(probeTab(V3_TAB)).resolves.toBe("none");
    tabs.sendMessage.mockRejectedValue(
      new Error("The message port closed before a response was received."),
    );
    await expect(probeTab(V3_TAB)).resolves.toBe("none");
  });

  it("without host access it leaves the fix to the permission banner", async () => {
    permissions.contains.mockResolvedValue(false);
    await expect(probeTab(V3_TAB)).resolves.toBe("none");
    expect(tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("does not ask a tab that is still loading, nor a non-Intra one", async () => {
    await expect(probeTab({ ...V3_TAB, status: "loading" })).resolves.toBe(
      "none",
    );
    await expect(
      probeTab({ ...V3_TAB, url: "https://example.com/" }),
    ).resolves.toBe("none");
    expect(tabs.sendMessage).not.toHaveBeenCalled();
  });
});

describe("renderTabStatus", () => {
  it("not running: says why, and reloads only when asked", () => {
    const box = document.createElement("div");
    renderTabStatus(box, "not-running", 7);
    expect(box.textContent).toMatch(/not running on this tab yet/);
    expect(tabs.reload).not.toHaveBeenCalled();
    (box.querySelector("[data-reload-tab]") as HTMLButtonElement).click();
    expect(tabs.reload).toHaveBeenCalledWith(7);
    expect(close).toHaveBeenCalled();
  });

  it("Open settings asks the tab, and closes once the hub answered", async () => {
    let answer!: (v: unknown) => void;
    tabs.sendMessage.mockReturnValue(new Promise((r) => (answer = r)));
    const box = document.createElement("div");
    renderTabStatus(box, "hub", 7);
    (box.querySelector("[data-open-settings]") as HTMLButtonElement).click();
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, { type: OPEN_HUB_MESSAGE });
    expect(close).not.toHaveBeenCalled();
    answer({ ok: true });
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("from a v2 page, opens the v3 profile", () => {
    const box = document.createElement("div");
    renderTabStatus(box, "v2", 7);
    (box.querySelector("[data-open-v3]") as HTMLButtonElement).click();
    expect(tabs.create).toHaveBeenCalledWith({
      url: "https://profile-v3.intra.42.fr/",
    });
  });

  it("renders nothing when the popup cannot tell", () => {
    const box = document.createElement("div");
    renderTabStatus(box, "none", 7);
    expect(box.querySelector("button")).toBeNull();
  });
});

describe("answerPopupMessage (content script)", () => {
  const onHost = (hostname: string) =>
    vi.spyOn(window, "location", "get").mockReturnValue({
      hostname,
    } as Location);

  it("answers FT_PING at once with whether the hub opens here", () => {
    const openHub = vi.fn(async () => {});
    const reply = vi.fn();
    onHost("profile-v3.intra.42.fr");
    answerPopupMessage({ type: PING_MESSAGE }, reply, { openHub });
    expect(reply).toHaveBeenCalledWith({ ok: true, hub: true });

    onHost("projects.intra.42.fr");
    answerPopupMessage({ type: PING_MESSAGE }, reply, { openHub });
    expect(reply).toHaveBeenLastCalledWith({ ok: true, hub: false });
    expect(openHub).not.toHaveBeenCalled();
  });

  it("answers FT_OPEN_HUB after the hub is open, keeping the channel open", async () => {
    onHost("profile-v3.intra.42.fr");
    let opened!: () => void;
    const openHub = vi.fn(() => new Promise<void>((r) => (opened = r)));
    const reply = vi.fn();
    expect(answerPopupMessage({ type: OPEN_HUB_MESSAGE }, reply, { openHub }))
      .toBe(true);
    expect(openHub).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
    opened();
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: true }));
  });

  it("leaves other messages to other listeners", () => {
    const reply = vi.fn();
    expect(
      answerPopupMessage({ type: "FT_FETCH_INTRA_PAGE" }, reply, {
        openHub: vi.fn(),
      }),
    ).toBeUndefined();
    expect(answerPopupMessage(null, reply, { openHub: vi.fn() })).toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
  });
});
