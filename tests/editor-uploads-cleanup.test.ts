/**
 * An uploaded image is public at /img/<login hash>/<slot>, a URL anyone can
 * compute from a login. Clearing the field, pasting a link over it or Reset
 * now deletes it from the worker (DELETE /api/v1/private/images?slot=), and
 * the URL history keeps one entry per uploaded slot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashLogin } from "../src/core/crypto.ts";

const account = vi.hoisted(() => ({
  fetchMySettings: vi.fn(async () => null as Record<string, unknown> | null),
  syncMyVisuals: vi.fn(async (_v: Record<string, unknown>) => {}),
  loginWith42: vi.fn(),
  clearAuthFailed: vi.fn(async () => {}),
  getCloudLogin: vi.fn(async () => "alice"),
}));
vi.mock("../src/features/account/account.ts", () => account);

const paint = vi.hoisted(() => ({
  applyImgs: vi.fn(),
  injectCustomStyles: vi.fn(),
  applyBadgeLayout: vi.fn(),
}));
vi.mock("../src/features/profile/header/visuals-apply.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyImgs: paint.applyImgs,
  injectCustomStyles: paint.injectCustomStyles,
}));
vi.mock("../src/features/profile/header/badges.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyBadgeLayout: paint.applyBadgeLayout,
}));
vi.mock("../src/core/theme/theme-manager.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEffectiveTheme: async () => "dark",
}));

const { createSettingsModal } = await import("../src/features/profile/header/profile.modal.ts");
const { deleteUnusedUploads } = await import("../src/features/profile/header/upload-cleanup.ts");
const { deleteProfileImage } = await import("../src/features/profile/header/image-upload.ts");
const { addToHistory } = await import("../src/features/profile/header/profile-modal-form.ts");

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
  setTimeout(() => this.dispatchEvent(new Event("close")), 0);
};

const WORKER = "https://api.betterintra.com";
let HASH = "";
const own = (slot: string, v = 1) => `${WORKER}/img/${HASH}/${slot}?v=${v}`;

type FetchCall = { url: string; method: string };
let calls: FetchCall[] = [];
function stubFetch(status = 204) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET" });
      return new Response(null, { status });
    }),
  );
}
const deletes = () => calls.filter((c) => c.method === "DELETE").map((c) => new URL(c.url).searchParams.get("slot"));

function host() {
  return document.getElementById("profile-modal-host") as HTMLDialogElement | null;
}
function shadow(): ShadowRoot {
  return host()!.querySelector("div")!.shadowRoot!;
}
function typeUrl(value: string) {
  const input = shadow().querySelector<HTMLInputElement>("input[type=url]")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(async () => {
  HASH = await hashLogin("alice");
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CLOUD_LOGIN: "alice" });
  vi.clearAllMocks();
  account.fetchMySettings.mockResolvedValue(null);
  stubFetch();
});

afterEach(() => {
  host()?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deleteUnusedUploads", () => {
  it("deletes an upload no field uses any more, once the cloud copy agrees", async () => {
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: "" });
    const deleted = await deleteUnusedUploads([own("avatar")], [], [""]);
    expect(deleted).toEqual(["avatar"]);
    expect(deletes()).toEqual(["avatar"]);
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.url).toMatch(/\/api\/v1\/private\/images\?slot=avatar&login=[a-f0-9]{64}$/);
  });

  it("keeps an upload the cloud copy still names (the push did not go through)", async () => {
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: own("avatar") });
    expect(await deleteUnusedUploads([own("avatar")], [], ["https://img.example/link.png"])).toEqual(
      [],
    );
    expect(deletes()).toEqual([]);
  });

  it("keeps everything when the cloud copy cannot be read", async () => {
    account.fetchMySettings.mockResolvedValue(null);
    expect(await deleteUnusedUploads([own("banner")], [], [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("keeps an upload still used by another field (the avatar pasted as the background)", async () => {
    account.fetchMySettings.mockResolvedValue({});
    expect(await deleteUnusedUploads([own("avatar")], [], ["", "", own("avatar", 1)])).toEqual([]);
    expect(account.fetchMySettings).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("costs no request at all for someone who never uploaded", async () => {
    expect(
      await deleteUnusedUploads(["https://img.example/a.png"], [], ["https://img.example/b.png"]),
    ).toEqual([]);
    expect(account.fetchMySettings).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("never touches another login's images or another host's look-alike path", async () => {
    const other = await hashLogin("bob");
    account.fetchMySettings.mockResolvedValue({});
    expect(
      await deleteUnusedUploads(
        [`${WORKER}/img/${other}/avatar?v=1`, `https://evil.example/img/${HASH}/banner?v=1`],
        [],
        [],
      ),
    ).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("deletes a slot this editor uploaded and nothing ended up using", async () => {
    account.fetchMySettings.mockResolvedValue({});
    expect(await deleteUnusedUploads([], ["banner"], ["https://img.example/a.png"])).toEqual([
      "banner",
    ]);
  });

  it("drops the deleted upload's thumbnails from the URL history", async () => {
    await chrome.storage.local.set({
      PROFILE_IMAGE_HISTORY: [own("avatar", 3), "https://img.example/a.png"],
      PROFILE_BACKGROUND_HISTORY: [own("avatar", 3), own("background", 1)],
    });
    account.fetchMySettings.mockResolvedValue({});
    await deleteUnusedUploads([own("avatar", 3)], [], []);
    const h = await chrome.storage.local.get(["PROFILE_IMAGE_HISTORY", "PROFILE_BACKGROUND_HISTORY"]);
    expect(h.PROFILE_IMAGE_HISTORY).toEqual(["https://img.example/a.png"]);
    expect(h.PROFILE_BACKGROUND_HISTORY).toEqual([own("background", 1)]);
  });
});

describe("deleteProfileImage", () => {
  it("counts a 404 as gone, and a worker without the route as a silent no", async () => {
    stubFetch(404);
    expect(await deleteProfileImage("avatar")).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(405);
    expect(await deleteProfileImage("avatar")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    stubFetch(500);
    expect(await deleteProfileImage("avatar")).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe("the editor removes uploads it stops using", () => {
  it("Save after clearing an uploaded avatar deletes it, after the push", async () => {
    await chrome.storage.local.set({ PROFILE_IMAGE_URL: own("avatar") });
    // the cloud copy read on open, then the one read back after the push
    account.fetchMySettings
      .mockResolvedValueOnce({ PROFILE_IMAGE_URL: own("avatar") })
      .mockResolvedValue({ PROFILE_IMAGE_URL: "" });
    const onSave = vi.fn();
    await createSettingsModal(onSave);
    typeUrl("");
    shadow().querySelector<HTMLElement>("#profile-save")!.click();

    await vi.waitFor(() => expect(deletes()).toEqual(["avatar"]));
    expect(onSave).toHaveBeenCalled();
    expect(account.syncMyVisuals.mock.invocationCallOrder[0]).toBeLessThan(
      account.fetchMySettings.mock.invocationCallOrder.at(-1)!,
    );
  });

  it("Save after pasting a link over an uploaded banner deletes the upload", async () => {
    await chrome.storage.local.set({ PROFILE_BANNER_URL: own("banner") });
    account.fetchMySettings
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ PROFILE_BANNER_URL: "https://img.example/b.png" });
    await createSettingsModal(vi.fn());
    [...shadow().querySelectorAll<HTMLButtonElement>("[role=tab]")]
      .find((b) => b.textContent?.trim() === "Banner")!
      .click();
    typeUrl("https://img.example/b.png");
    shadow().querySelector<HTMLElement>("#profile-save")!.click();
    await vi.waitFor(() => expect(deletes()).toEqual(["banner"]));
  });

  it("Save that keeps the upload sends no delete and reads nothing back", async () => {
    await chrome.storage.local.set({ PROFILE_IMAGE_URL: own("avatar") });
    const onSave = vi.fn();
    await createSettingsModal(onSave);
    shadow().querySelector<HTMLElement>("#profile-save")!.click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(account.fetchMySettings).toHaveBeenCalledTimes(1); // the open only
    expect(deletes()).toEqual([]);
  });

  it("Reset deletes the uploads before the page reloads", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await chrome.storage.local.set({
      PROFILE_IMAGE_URL: own("avatar"),
      PROFILE_BACKGROUND_URL: own("background"),
    });
    account.fetchMySettings.mockResolvedValueOnce(null).mockResolvedValue({});
    await createSettingsModal(vi.fn());
    shadow().querySelector<HTMLElement>("#profile-reset-btn")!.click();
    await vi.waitFor(() => expect(host()).toBeNull());
    expect(deletes()).toEqual(["avatar", "background"]);
  });
});

describe("URL history", () => {
  it("keeps only the newest entry of an uploaded slot", () => {
    const history = [own("avatar", 2), "https://img.example/a.png", own("avatar", 1), own("banner", 1)];
    expect(addToHistory(own("avatar", 3), history)).toEqual([
      own("avatar", 3),
      "https://img.example/a.png",
      own("banner", 1),
    ]);
  });

  it("still dedupes plain links by the exact URL only", () => {
    expect(
      addToHistory("https://img.example/a.png?v=2", ["https://img.example/a.png?v=1"]),
    ).toEqual(["https://img.example/a.png?v=2", "https://img.example/a.png?v=1"]);
  });

  it("the storage listener applies the same rule", async () => {
    let listener: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | null =
      null;
    const storage = chrome.storage as unknown as { onChanged?: unknown };
    storage.onChanged = { addListener: (fn: typeof listener) => (listener = fn) };
    try {
      vi.resetModules();
      const { installHistoryListener } = await import(
        "../src/features/profile/header/visuals-cache.ts"
      );
      installHistoryListener();
      await chrome.storage.local.set({ PROFILE_IMAGE_HISTORY: [own("avatar", 1), "https://img.example/a.png"] });
      listener!({ PROFILE_IMAGE_URL: { newValue: own("avatar", 2) } }, "local");
      await vi.waitFor(async () => {
        expect((await chrome.storage.local.get("PROFILE_IMAGE_HISTORY")).PROFILE_IMAGE_HISTORY).toEqual([
          own("avatar", 2),
          "https://img.example/a.png",
        ]);
      });
    } finally {
      delete storage.onChanged;
    }
  });
});
