/**
 * A removed upload is deleted only once the cloud copy no longer names it.
 * When the push that should have replaced it failed (a 429, the network),
 * the cleanup used to give up for good: the next push wrote the new URL and
 * the old picture stayed public at /img/<sha256(login)>/<slot>. The slot now
 * waits in a local-only list (PENDING_IMAGE_CLEANUP) and every later cleanup
 * tries it again: the editor's next Save, and the next visit of my profile.
 * A slot the cloud copy names differently since (put back on purpose) leaves
 * the list: a stale push taking it out again must not delete it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashLogin } from "../src/core/crypto.ts";
import { AVATAR_SELECTOR } from "../src/core/intra/selectors.ts";
import { CLOUD_SYNC_KEYS, VISUAL_CLOUD_KEYS } from "../src/core/config.ts";
import { exportableSettings, sanitizeBackup } from "../src/features/hub/backup.ts";

const account = vi.hoisted(() => ({
  fetchMySettings: vi.fn(async () => null as Record<string, unknown> | null),
  syncMyVisuals: vi.fn(async (_v: Record<string, unknown>) => {}),
  fetchUserVisuals: vi.fn(async () => null),
  loginWith42: vi.fn(),
  clearAuthFailed: vi.fn(async () => {}),
  getCloudLogin: vi.fn(async () => "alice"),
}));
vi.mock("../src/features/account/account.ts", () => account);

vi.mock("../src/features/profile/header/visuals-apply.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyImgs: vi.fn(),
  injectCustomStyles: vi.fn(),
}));
vi.mock("../src/features/profile/header/badges.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyBadgeLayout: vi.fn(),
}));
vi.mock("../src/core/theme/theme-manager.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEffectiveTheme: async () => "dark",
}));
// my own public extras, applied by the same profile pass: another concern
vi.mock("../src/features/profile/extras/extras-apply.ts", () => ({
  applyOwnProfileExtras: vi.fn(async () => {}),
  pickRawExtras: () => null,
}));

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

const KEY = "PENDING_IMAGE_CLEANUP";
const WORKER = "https://api.betterintra.com";
const LINK = "https://img.example/link.png";
const MINUTE = 60_000;
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
const deletes = () =>
  calls.filter((c) => c.method === "DELETE").map((c) => new URL(c.url).searchParams.get("slot"));

async function pending(): Promise<{ hash?: string; slots?: string[]; triedAt?: number } | undefined> {
  return (await chrome.storage.local.get(KEY))[KEY] as never;
}

/** A fresh copy of the modules: the visit retry runs once per page. */
async function freshModules() {
  vi.resetModules();
  return {
    cleanup: await import("../src/features/profile/header/upload-cleanup.ts"),
    modal: await import("../src/features/profile/header/profile.modal.ts"),
    visuals: await import("../src/features/profile/header/visuals.ts"),
  };
}

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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubFetch();
});

afterEach(() => {
  host()?.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the pending list", () => {
  it("keeps a slot the cloud copy still names, and deletes it once a later push replaced the URL", async () => {
    const { cleanup } = await freshModules();
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: own("avatar") });
    expect(await cleanup.deleteUnusedUploads([own("avatar")], [], [LINK])).toEqual([]);
    expect(deletes()).toEqual([]);
    const kept = await pending();
    expect(kept).toMatchObject({ hash: HASH, slots: ["avatar"] });
    expect(kept!.triedAt).toBeGreaterThan(Date.now() - MINUTE);

    // a later push wrote the link: the next cleanup, with no candidate of its own, deletes it
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: LINK });
    expect(await cleanup.deleteUnusedUploads([], [], [LINK])).toEqual(["avatar"]);
    expect(deletes()).toEqual(["avatar"]);
    expect(await pending()).toBeUndefined();
  });

  it("keeps the slots when the cloud copy cannot be read or the delete is refused", async () => {
    const { cleanup } = await freshModules();
    expect(await cleanup.deleteUnusedUploads([own("banner")], [], [])).toEqual([]);
    expect(calls).toHaveLength(0);
    expect((await pending())?.slots).toEqual(["banner"]);

    // the DELETE shares the push's write limit
    stubFetch(429);
    account.fetchMySettings.mockResolvedValue({});
    expect(await cleanup.deleteUnusedUploads([], ["background"], [])).toEqual([]);
    expect(deletes()).toEqual(["banner", "background"]);
    expect((await pending())?.slots).toEqual(["banner", "background"]);

    stubFetch(204);
    expect(await cleanup.deleteUnusedUploads([], [], [])).toEqual(["banner", "background"]);
    expect(await pending()).toBeUndefined();
  });

  it("drops a slot the cloud copy names anew, and deletes nothing when a stale push takes it out again", async () => {
    const { cleanup } = await freshModules();
    // removed here, the push failed: the copy still names v=1
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: own("avatar", 1) });
    await cleanup.deleteUnusedUploads([own("avatar", 1)], [], [LINK]);
    await cleanup.deleteUnusedUploads([], [], [LINK]);
    expect(await pending()).toMatchObject({ slots: ["avatar"], seen: { avatar: "PROFILE_IMAGE_URL=1" } });

    // another browser uploaded a new avatar and pushed it: the old bytes are gone already
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: own("avatar", 5) });
    expect(await cleanup.deleteUnusedUploads([], [], [LINK])).toEqual([]);
    expect(await pending()).toBeUndefined();

    // this browser's stale settings then overwrite the copy: that avatar must survive
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: LINK });
    expect(await cleanup.deleteUnusedUploads([], [], [LINK])).toEqual([]);
    expect(deletes()).toEqual([]);
  });

  it("drops a slot whose delete was refused once a push names it again", async () => {
    const { cleanup } = await freshModules();
    stubFetch(429);
    account.fetchMySettings.mockResolvedValue({});
    await cleanup.deleteUnusedUploads([own("banner")], [], []);
    expect(await pending()).toMatchObject({ slots: ["banner"], seen: { banner: "" } });

    stubFetch(204);
    account.fetchMySettings.mockResolvedValue({ PROFILE_BANNER_URL: own("banner", 7) });
    expect(await cleanup.deleteUnusedUploads([], [], [])).toEqual([]);
    expect(deletes()).toEqual([]);
    expect(await pending()).toBeUndefined();
  });

  it("takes the first readable copy as the reference when the removal could not read it", async () => {
    const { cleanup } = await freshModules();
    await cleanup.deleteUnusedUploads([own("avatar", 1)], [], []);
    expect((await pending())?.seen).toEqual({});
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: own("avatar", 1) });
    await cleanup.deleteUnusedUploads([], [], []);
    expect(await pending()).toMatchObject({ slots: ["avatar"], seen: { avatar: "PROFILE_IMAGE_URL=1" } });
    account.fetchMySettings.mockResolvedValue({});
    expect(await cleanup.deleteUnusedUploads([], [], [])).toEqual(["avatar"]);
  });

  it("a new removal of a pending slot replaces what the list knew about it", async () => {
    const { cleanup } = await freshModules();
    await chrome.storage.local.set({
      [KEY]: { hash: HASH, slots: ["avatar"], seen: { avatar: "PROFILE_IMAGE_URL=1" }, triedAt: 0 },
    });
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: own("avatar", 5) });
    await cleanup.deleteUnusedUploads([own("avatar", 5)], [], [LINK]);
    expect(await pending()).toMatchObject({ slots: ["avatar"], seen: { avatar: "PROFILE_IMAGE_URL=5" } });

    // unreadable this time: the older read says nothing about this removal
    account.fetchMySettings.mockResolvedValue(null);
    await cleanup.deleteUnusedUploads([own("avatar", 8)], [], [LINK]);
    expect(await pending()).toMatchObject({ slots: ["avatar"], seen: {} });
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: own("avatar", 8) });
    await cleanup.deleteUnusedUploads([], [], [LINK]);
    expect((await pending())?.slots).toEqual(["avatar"]);
  });

  it("never deletes a slot another tab saved into a field while the copy was read", async () => {
    const { cleanup } = await freshModules();
    await chrome.storage.local.set({ [KEY]: { hash: HASH, slots: ["avatar"], triedAt: 0 } });
    account.fetchMySettings.mockImplementation(async () => {
      // the other tab's Save: a new upload into the slot, stored before its push
      await chrome.storage.local.set({ PROFILE_IMAGE_URL: own("avatar", 9) });
      return {};
    });
    expect(await cleanup.deleteUnusedUploads([], [], [])).toEqual([]);
    expect(deletes()).toEqual([]);
    expect(await pending()).toBeUndefined();
  });

  it("drops a pending slot a field uses again, without any request", async () => {
    const { cleanup } = await freshModules();
    await chrome.storage.local.set({ [KEY]: { hash: HASH, slots: ["avatar"], triedAt: 0 } });
    expect(await cleanup.deleteUnusedUploads([], [], [own("avatar", 2)])).toEqual([]);
    expect(account.fetchMySettings).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(await pending()).toBeUndefined();
  });

  it("never acts on another login's list", async () => {
    const { cleanup } = await freshModules();
    const other = { hash: await hashLogin("bob"), slots: ["avatar"], triedAt: 0 };
    await chrome.storage.local.set({ [KEY]: other });
    account.fetchMySettings.mockResolvedValue({});
    expect(await cleanup.deleteUnusedUploads([], [], [])).toEqual([]);
    await cleanup.retryPendingUploadCleanup();
    expect(account.fetchMySettings).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(await pending()).toEqual(other);
  });

  it("two cleanups at once keep each other's slots", async () => {
    const { cleanup } = await freshModules();
    account.fetchMySettings
      .mockResolvedValueOnce({ PROFILE_IMAGE_URL: own("avatar") })
      .mockResolvedValueOnce(null);
    await Promise.all([
      cleanup.deleteUnusedUploads([own("avatar")], [], []),
      cleanup.deleteUnusedUploads([own("banner")], [], []),
    ]);
    expect((await pending())?.slots).toEqual(["avatar", "banner"]);
  });

  it("writes nothing for a student with nothing pending", async () => {
    const { cleanup } = await freshModules();
    const set = vi.spyOn(chrome.storage.local, "set");
    await cleanup.deleteUnusedUploads([LINK], [], [LINK]);
    await cleanup.deleteUnusedUploads([own("avatar")], [], [own("avatar")]);
    expect(set).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("stays on this browser: not in the cloud copy, not in a backup file", () => {
    expect(CLOUD_SYNC_KEYS as readonly string[]).not.toContain(KEY);
    expect(VISUAL_CLOUD_KEYS as readonly string[]).not.toContain(KEY);
    const record = { hash: HASH, slots: ["avatar"], triedAt: 1 };
    expect(exportableSettings({ [KEY]: record })).toEqual({});
    expect(sanitizeBackup({ [KEY]: record })).toEqual({});
  });
});

describe("the retry on a visit of my profile", () => {
  it("costs no request when nothing is pending", async () => {
    const { cleanup } = await freshModules();
    await cleanup.retryPendingUploadCleanup();
    expect(account.fetchMySettings).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("tries the pending slots against the fields of this browser, once per page", async () => {
    const { cleanup } = await freshModules();
    await chrome.storage.local.set({
      PROFILE_IMAGE_URL: LINK,
      [KEY]: { hash: HASH, slots: ["avatar"], triedAt: Date.now() - 11 * MINUTE },
    });
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: LINK });
    await cleanup.retryPendingUploadCleanup();
    expect(deletes()).toEqual(["avatar"]);
    expect(await pending()).toBeUndefined();

    await chrome.storage.local.set({ [KEY]: { hash: HASH, slots: ["banner"], triedAt: 0 } });
    await cleanup.retryPendingUploadCleanup();
    expect(deletes()).toEqual(["avatar"]);
  });

  it("waits ten minutes after a try that failed", async () => {
    const { cleanup } = await freshModules();
    await chrome.storage.local.set({
      [KEY]: { hash: HASH, slots: ["avatar"], triedAt: Date.now() - MINUTE },
    });
    account.fetchMySettings.mockResolvedValue({});
    await cleanup.retryPendingUploadCleanup();
    expect(account.fetchMySettings).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("is not held off for good by a try dated in the future (a clock set back)", async () => {
    const { cleanup } = await freshModules();
    await chrome.storage.local.set({
      [KEY]: { hash: HASH, slots: ["avatar"], triedAt: Date.now() + 24 * 60 * MINUTE },
    });
    account.fetchMySettings.mockResolvedValue({});
    await cleanup.retryPendingUploadCleanup();
    expect(deletes()).toEqual(["avatar"]);
  });

  it("waits for a new sign-in while the session is refused", async () => {
    const { cleanup } = await freshModules();
    await chrome.storage.local.set({
      CLOUD_AUTH_FAILED: true,
      [KEY]: { hash: HASH, slots: ["avatar"], triedAt: 0 },
    });
    account.fetchMySettings.mockResolvedValue({});
    await cleanup.retryPendingUploadCleanup();
    expect(account.fetchMySettings).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("runs from the profile pass on my own page", async () => {
    history.replaceState({}, "", "/");
    await chrome.storage.local.set({ [KEY]: { hash: HASH, slots: ["banner"], triedAt: 0 } });
    account.fetchMySettings.mockResolvedValue({});
    const el = document.createElement("div");
    el.className = AVATAR_SELECTOR.split(".").filter(Boolean).slice(1).join(" ");
    document.body.appendChild(el);

    const { visuals } = await freshModules();
    await visuals.updateVisuals();
    await vi.waitFor(() => expect(deletes()).toEqual(["banner"]));
    await visuals.updateVisuals();
    await new Promise((r) => setTimeout(r, 20));
    expect(account.fetchMySettings).toHaveBeenCalledTimes(1);
  });
});

describe("the editor", () => {
  it("a Save whose push failed leaves the removed upload pending, and a later visit deletes it", async () => {
    await chrome.storage.local.set({ PROFILE_IMAGE_URL: own("avatar") });
    // the push fails: the copy read back still names the upload
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: own("avatar") });
    const first = await freshModules();
    await first.modal.createSettingsModal(vi.fn());
    typeUrl("");
    shadow().querySelector<HTMLElement>("#profile-save")!.click();
    await vi.waitFor(async () => expect((await pending())?.slots).toEqual(["avatar"]));
    expect(deletes()).toEqual([]);

    // a full push went through since, and the ten minutes are over
    account.fetchMySettings.mockResolvedValue({ PROFILE_IMAGE_URL: "" });
    await chrome.storage.local.set({ [KEY]: { ...(await pending()), triedAt: Date.now() - 11 * MINUTE } });
    const next = await freshModules();
    await next.cleanup.retryPendingUploadCleanup();
    expect(deletes()).toEqual(["avatar"]);
    expect(await pending()).toBeUndefined();
  });

  it("the next Save tries a slot an earlier one left pending", async () => {
    await chrome.storage.local.set({
      PROFILE_IMAGE_URL: LINK,
      [KEY]: { hash: HASH, slots: ["banner"], triedAt: Date.now() },
    });
    account.fetchMySettings.mockResolvedValueOnce(null).mockResolvedValue({ PROFILE_IMAGE_URL: LINK });
    const { modal } = await freshModules();
    const onSave = vi.fn();
    await modal.createSettingsModal(onSave);
    shadow().querySelector<HTMLElement>("#profile-save")!.click();
    await vi.waitFor(() => expect(deletes()).toEqual(["banner"]));
    expect(onSave).toHaveBeenCalled();
    await vi.waitFor(async () => expect(await pending()).toBeUndefined());
  });
});
