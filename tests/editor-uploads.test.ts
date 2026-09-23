/**
 * Profile images picked in the visuals editor are uploaded on Save, not when
 * the file is picked. The worker keeps one image per slot and serves it under
 * the saved URL whatever its ?v= says, so an upload made to try a picture
 * out published it, even after Cancel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashLogin } from "../src/core/crypto.ts";

const account = vi.hoisted(() => ({
  fetchMySettings: vi.fn(async () => null as Record<string, unknown> | null),
  syncMyVisuals: vi.fn(async (_v: Record<string, unknown>) => {}),
  loginWith42: vi.fn(),
  clearAuthFailed: vi.fn(async () => {}),
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

// jsdom has HTMLDialogElement but neither showModal() nor close().
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
const uploadedUrl = (slot: string, v: number) => `${WORKER}/img/${HASH}/${slot}?v=${v}`;

function host() {
  return document.getElementById("profile-modal-host") as HTMLDialogElement | null;
}
function shadow(): ShadowRoot {
  return host()!.querySelector("div")!.shadowRoot!;
}
function saveButton() {
  return shadow().querySelector<HTMLButtonElement>("#profile-save")!;
}
function openTab(label: string) {
  const tab = [...shadow().querySelectorAll<HTMLButtonElement>("[role=tab]")].find(
    (b) => b.textContent?.trim() === label,
  )!;
  tab.click();
}

const png = (name = "me.png", size = 64) =>
  new File([new Uint8Array(size).fill(7)], name, { type: "image/png" });

/** Picks `file` with the Upload button of the tab on screen. */
async function pick(file: File) {
  const input = shadow().querySelector<HTMLInputElement>("[data-upload-input]")!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => {
    expect(shadow().querySelector("[data-upload-pending]")).not.toBeNull();
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type FetchCall = { url: string; method: string };
let calls: FetchCall[] = [];
/** Stubs fetch; `answer` gets each request and returns its response. */
function stubFetch(answer: (call: FetchCall) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? "GET" };
      calls.push(call);
      return answer(call);
    }),
  );
}
const uploads = () => calls.filter((c) => c.method === "POST" && c.url.includes("/private/images"));
const deletes = () => calls.filter((c) => c.method === "DELETE");

async function openEditor(onSave = vi.fn()) {
  await createSettingsModal(onSave);
  expect(host()?.open).toBe(true);
  return onSave;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 3; i++) await tick();
}

beforeEach(async () => {
  HASH = await hashLogin("alice");
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    CLOUD_TOKEN: "sess",
    CLOUD_LOGIN: "alice",
    PROFILE_IMAGE_URL: "https://img.example/old-avatar.png",
    PROFILE_BANNER_URL: "https://img.example/old-banner.png",
    PROFILE_BANNER_MODE: "fill",
  });
  vi.clearAllMocks();
  account.fetchMySettings.mockResolvedValue(null);
  stubFetch(() => json({ url: uploadedUrl("avatar", 2) }));
});

afterEach(() => {
  host()?.remove();
  document.getElementById("ft-local-preview-style")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("picking an image", () => {
  it("sends nothing and previews the file locally", async () => {
    await openEditor();
    await pick(png());

    expect(calls).toHaveLength(0);
    const preview = shadow().querySelector<HTMLElement>("#ft-avatar-preview")!;
    expect(preview.getAttribute("style")).toContain("var(--ft-avatar-local)");
    expect(preview.parentElement!.getAttribute("style")).toMatch(
      /--ft-avatar-local:url\("data:image\/png;base64,[A-Za-z0-9+/=]+"\)/,
    );
    expect(shadow().querySelector("[data-upload-pending]")!.textContent).toContain(
      "me.png: uploads when you save",
    );
    // the box is emptied: the file replaces the URL
    expect(shadow().querySelector<HTMLInputElement>("input[type=url]")!.value).toBe("");
    expect((await chrome.storage.local.get("PROFILE_IMAGE_URL")).PROFILE_IMAGE_URL).toBe(
      "https://img.example/old-avatar.png",
    );
  });

  it("a picked banner is painted on the page, over the saved one, and only there", async () => {
    await openEditor();
    openTab("Banner");
    await pick(png("wide.png"));
    const sheet = document.getElementById("ft-local-preview-style")!;
    expect(sheet.textContent).toMatch(/^:root div\.border-neutral-600.*url\("data:image\/png;base64,/);
    expect(sheet.textContent).toContain("background-size: cover !important");
    // applyImgs() never sees the data: URL: it paints the saved banner below
    expect(JSON.stringify(paint.applyImgs.mock.calls)).not.toContain("data:");
  });

  it("Save waits for a photo that is still being shrunk", async () => {
    const decoded = deferred<{ width: number; height: number; close: () => void }>();
    vi.stubGlobal("createImageBitmap", vi.fn(() => decoded.promise));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage() {} };
        }
        async convertToBlob() {
          return new Blob([new Uint8Array(1000).fill(1)], { type: "image/jpeg" });
        }
      },
    );
    const onSave = await openEditor();
    const input = shadow().querySelector<HTMLInputElement>("[data-upload-input]")!;
    const photo = new File([new Uint8Array(3 * 1024 * 1024)], "phone.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [photo] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(saveButton().disabled).toBe(true));
    saveButton().click();
    await settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(account.syncMyVisuals).not.toHaveBeenCalled();

    decoded.resolve({ width: 4000, height: 3000, close() {} });
    await vi.waitFor(() => expect(shadow().querySelector("[data-upload-pending]")).not.toBeNull());
    expect(saveButton().disabled).toBe(false);
    saveButton().click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(uploads()).toHaveLength(1);
  });

  it("typing a URL drops the picked file", async () => {
    const onSave = await openEditor();
    await pick(png());
    const input = shadow().querySelector<HTMLInputElement>("input[type=url]")!;
    input.value = "https://img.example/typed.png";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(shadow().querySelector("[data-upload-pending]")).toBeNull();

    saveButton().click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(uploads()).toHaveLength(0);
    expect((await chrome.storage.local.get("PROFILE_IMAGE_URL")).PROFILE_IMAGE_URL).toBe(
      "https://img.example/typed.png",
    );
  });
});

describe("closing without saving", () => {
  it("sends nothing, stores nothing and takes the page preview away", async () => {
    await openEditor();
    openTab("Banner");
    await pick(png("wide.png"));
    expect(document.getElementById("ft-local-preview-style")).not.toBeNull();

    shadow().querySelector<HTMLElement>("#profile-close-btn")!.click();
    await settle();
    expect(host()).toBeNull();
    expect(calls).toHaveLength(0);
    expect(document.getElementById("ft-local-preview-style")).toBeNull();
    expect((await chrome.storage.local.get("PROFILE_BANNER_URL")).PROFILE_BANNER_URL).toBe(
      "https://img.example/old-banner.png",
    );
    expect(account.syncMyVisuals).not.toHaveBeenCalled();
  });
});

describe("Save", () => {
  it("uploads the picked file first, then stores and pushes the URL the worker answered", async () => {
    const upload = deferred<Response>();
    stubFetch(() => upload.promise);
    const onSave = await openEditor();
    await pick(png());

    saveButton().click();
    await vi.waitFor(() => expect(uploads()).toHaveLength(1));
    // busy: no second Save, no push before the upload answered
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().textContent).toContain("Saving");
    expect(account.syncMyVisuals).not.toHaveBeenCalled();

    upload.resolve(json({ url: uploadedUrl("avatar", 2) }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ avatar: uploadedUrl("avatar", 2) });
    expect(account.syncMyVisuals.mock.calls[0][0]).toMatchObject({
      avatar: uploadedUrl("avatar", 2),
    });
    const stored = await chrome.storage.local.get(["PROFILE_IMAGE_URL", "PROFILE_IMAGE_HISTORY"]);
    expect(stored.PROFILE_IMAGE_URL).toBe(uploadedUrl("avatar", 2));
    expect(stored.PROFILE_IMAGE_HISTORY).toContain(uploadedUrl("avatar", 2));
    expect(JSON.stringify(stored)).not.toContain("data:");
    await settle();
    expect(host()).toBeNull();
  });

  it("a failed upload keeps the editor open with the error, and stores nothing", async () => {
    stubFetch(() => new Response("slow down", { status: 429 }));
    const onSave = await openEditor();
    await pick(png());

    saveButton().click();
    await vi.waitFor(() => {
      expect(shadow().querySelector("[data-save-error]")?.textContent).toContain(
        "Avatar: Too many uploads",
      );
    });
    expect(host()?.open).toBe(true);
    expect(saveButton().disabled).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(account.syncMyVisuals).not.toHaveBeenCalled();
    expect((await chrome.storage.local.get("PROFILE_IMAGE_URL")).PROFILE_IMAGE_URL).toBe(
      "https://img.example/old-avatar.png",
    );
    // the file is still there: Save again once the worker accepts it
    expect(shadow().querySelector("[data-upload-pending]")).not.toBeNull();
    stubFetch(() => json({ url: uploadedUrl("avatar", 3) }));
    saveButton().click();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((await chrome.storage.local.get("PROFILE_IMAGE_URL")).PROFILE_IMAGE_URL).toBe(
      uploadedUrl("avatar", 3),
    );
  });

  it("while it runs the X, the backdrop and Escape do not close the editor", async () => {
    const upload = deferred<Response>();
    stubFetch(() => upload.promise);
    await openEditor();
    await pick(png());
    saveButton().click();
    await vi.waitFor(() => expect(uploads()).toHaveLength(1));

    const dialog = host()!;
    const closeBtn = shadow().querySelector<HTMLButtonElement>("#profile-close-btn")!;
    expect(closeBtn.disabled).toBe(true);
    closeBtn.click();
    dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await settle();
    expect(dialog.open).toBe(true);
    upload.resolve(json({ url: uploadedUrl("avatar", 2) }));
  });

  it("a result that lands after the editor was closed anyway is dropped", async () => {
    const upload = deferred<Response>();
    stubFetch((call) => (call.method === "POST" ? upload.promise : new Response(null, { status: 204 })));
    const onSave = await openEditor();
    await pick(png());
    saveButton().click();
    await vi.waitFor(() => expect(uploads()).toHaveLength(1));

    host()!.close(); // what a second Escape does in Chrome
    await settle();
    const painted = paint.applyImgs.mock.calls.length;
    account.fetchMySettings.mockResolvedValue({
      PROFILE_IMAGE_URL: "https://img.example/old-avatar.png",
    });
    upload.resolve(json({ url: uploadedUrl("avatar", 2) }));

    // the upload is public but used by nothing: removed again
    await vi.waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].url).toContain("slot=avatar");
    expect(onSave).not.toHaveBeenCalled();
    expect(account.syncMyVisuals).not.toHaveBeenCalled();
    expect(paint.applyImgs.mock.calls.length).toBe(painted);
    expect((await chrome.storage.local.get("PROFILE_IMAGE_URL")).PROFILE_IMAGE_URL).toBe(
      "https://img.example/old-avatar.png",
    );
  });

  it("Cancel after a half-done Save removes the image that did go up", async () => {
    stubFetch((call) => {
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      return call.url.includes("slot=avatar")
        ? json({ url: uploadedUrl("avatar", 2) })
        : new Response("slow down", { status: 429 });
    });
    await openEditor();
    await pick(png());
    openTab("Banner");
    await pick(png("wide.png"));
    saveButton().click();
    await vi.waitFor(() => {
      expect(shadow().querySelector("[data-save-error]")?.textContent).toContain("Banner:");
    });
    expect(deletes()).toHaveLength(0);

    account.fetchMySettings.mockResolvedValue({
      PROFILE_IMAGE_URL: "https://img.example/old-avatar.png",
    });
    shadow().querySelector<HTMLElement>("#profile-close-btn")!.click();
    await vi.waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].url).toContain("slot=avatar");
    expect((await chrome.storage.local.get("PROFILE_IMAGE_URL")).PROFILE_IMAGE_URL).toBe(
      "https://img.example/old-avatar.png",
    );
  });

  it("an error does not come back when the editor is opened again", async () => {
    stubFetch(() => new Response("slow down", { status: 429 }));
    await openEditor();
    await pick(png());
    saveButton().click();
    await vi.waitFor(() => expect(shadow().querySelector("[data-save-error]")).not.toBeNull());
    expect(shadow().querySelector("[data-upload-status]")?.textContent).toContain("Too many");
    shadow().querySelector<HTMLElement>("#profile-close-btn")!.click();
    await settle();
    expect(host()).toBeNull();

    await openEditor();
    expect(shadow().querySelector("[data-upload-status]")).toBeNull();
    expect(shadow().querySelector("[data-upload-pending]")).toBeNull();
    expect(shadow().querySelector("[data-save-error]")).toBeNull();
  });
});
