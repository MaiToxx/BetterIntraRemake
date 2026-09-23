/**
 * Signing in from the toolbar popup: the notice first (inline, the first
 * time on this browser), a button that shows it is working and cannot start
 * a second sign-in, the failure under the button instead of in alert(), and
 * the same words everywhere (Sign in with 42, Sign in again, Sign out).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

vi.mock("../src/core/worker.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/worker.ts")>()),
  AUTH_MODE: "intra",
}));

import { initAccountSettings } from "../src/features/account/account.ui.ts";
import { INTRA_LOGIN_MESSAGE } from "../src/features/account/intra-login.ts";
import { WORKER_HOST } from "../src/core/worker.ts";

const tabs = {
  query: vi.fn(async () => [
    { id: 7, url: "https://profile-v3.intra.42.fr/users/alice" },
  ]),
  sendMessage: vi.fn(),
  reload: vi.fn(),
  create: vi.fn(),
};
const permissions = { request: vi.fn(async () => true) };

const settle = () => new Promise((r) => setTimeout(r, 0));
const text = (el: Element) => el.textContent!.replace(/\s+/g, " ");
const button = (root: Element, name: RegExp) =>
  [...root.querySelectorAll("button")].find((b) =>
    name.test(text(b)),
  ) as HTMLButtonElement | undefined;

beforeAll(() => {
  // The popup is an extension page: loginWith42 asks the active tab.
  const url = new URL("chrome-extension://abc/popup.html");
  Object.defineProperty(window, "location", {
    value: { href: url.href, protocol: url.protocol, hostname: url.hostname, reload: vi.fn() },
    writable: true,
    configurable: true,
  });
});

beforeEach(async () => {
  await chrome.storage.local.clear();
  tabs.sendMessage.mockReset();
  permissions.request.mockClear();
  (globalThis as any).chrome.tabs = tabs;
  (globalThis as any).chrome.permissions = permissions;
  (globalThis as any).chrome.runtime = {
    sendMessage: vi.fn(async () => undefined),
  };
  (globalThis as any).alert = vi.fn();
  (globalThis as any).fetch = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.spyOn(window, "close").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signed out", () => {
  it("explains the account in one line and names the server", async () => {
    const root = document.createElement("div");
    await initAccountSettings(root);
    expect(button(root, /Sign in with/)).toBeDefined();
    expect(text(root)).toMatch(/Optional/);
    expect(text(root)).toContain(WORKER_HOST);
    const privacy = [...root.querySelectorAll("a")].find((a) =>
      /Privacy policy/.test(a.textContent!),
    )!;
    expect(privacy.href).toMatch(/\/blob\/main\/PRIVACY\.md$/);
  });

  it("the first time, shows the notice before anything is asked or sent", async () => {
    const root = document.createElement("div");
    await initAccountSettings(root);
    button(root, /Sign in with/)!.click();
    await vi.waitFor(() =>
      expect(root.querySelector("[data-disclosure]")).not.toBeNull(),
    );
    expect(text(root)).toContain(WORKER_HOST);
    expect(permissions.request).not.toHaveBeenCalled();
    expect(tabs.sendMessage).not.toHaveBeenCalled();

    button(root, /^\s*Cancel\s*$/)!.click();
    await vi.waitFor(() =>
      expect(root.querySelector("[data-disclosure]")).toBeNull(),
    );
    expect(tabs.sendMessage).not.toHaveBeenCalled();
    expect(
      (await chrome.storage.local.get("SIGNIN_DISCLOSURE_ACCEPTED"))
        .SIGNIN_DISCLOSURE_ACCEPTED,
    ).toBeUndefined();
  });

  it("Sign in on the notice records it and signs in once, however many clicks", async () => {
    let answer!: (v: unknown) => void;
    tabs.sendMessage.mockReturnValue(new Promise((r) => (answer = r)));
    const root = document.createElement("div");
    await initAccountSettings(root);
    button(root, /Sign in with/)!.click();
    await vi.waitFor(() =>
      expect(root.querySelector("[data-accept]")).not.toBeNull(),
    );
    (root.querySelector("[data-accept]") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(tabs.sendMessage).toHaveBeenCalledTimes(1));
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: INTRA_LOGIN_MESSAGE,
    });
    expect(permissions.request).toHaveBeenCalledTimes(1);
    expect(
      (await chrome.storage.local.get("SIGNIN_DISCLOSURE_ACCEPTED"))
        .SIGNIN_DISCLOSURE_ACCEPTED,
    ).toBe(true);

    // working, and not clickable again
    await vi.waitFor(() => expect(text(root)).toContain("Signing in..."));
    const busy = root.querySelector("#signin-btn") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    busy.click();
    await settle();
    expect(tabs.sendMessage).toHaveBeenCalledTimes(1);

    answer({ ok: true, login: "alice" });
    await vi.waitFor(() => expect(window.close).toHaveBeenCalled());
  });

  it("once accepted, the button signs in straight away", async () => {
    await chrome.storage.local.set({ SIGNIN_DISCLOSURE_ACCEPTED: true });
    tabs.sendMessage.mockResolvedValue({ ok: true, login: "alice" });
    const root = document.createElement("div");
    await initAccountSettings(root);
    button(root, /Sign in with/)!.click();
    await vi.waitFor(() => expect(tabs.sendMessage).toHaveBeenCalledTimes(1));
    expect(root.querySelector("[data-disclosure]")).toBeNull();
  });

  it("a failure shows under the button, never in alert(), and the button comes back", async () => {
    await chrome.storage.local.set({ SIGNIN_DISCLOSURE_ACCEPTED: true });
    tabs.sendMessage.mockResolvedValue({
      ok: false,
      error:
        "Intra did not accept this page's session token. Reload the page, then try again.\nServer refused the login (401): signature",
    });
    const root = document.createElement("div");
    await initAccountSettings(root);
    button(root, /Sign in with/)!.click();
    await vi.waitFor(() =>
      expect(root.querySelector("[data-login-error]")).not.toBeNull(),
    );
    const error = root.querySelector("[data-login-error]")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(text(error.querySelector("p")!)).toBe(
      "Intra did not accept this page's session token. Reload the page, then try again.",
    );
    expect(alert).not.toHaveBeenCalled();
    expect((root.querySelector("#signin-btn") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("signed in", () => {
  beforeEach(async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CLOUD_LOGIN: "alice" });
  });

  it("says Sign out, and its confirm says the settings stay", async () => {
    const confirm = vi.fn(() => false);
    (globalThis as any).confirm = confirm;
    const root = document.createElement("div");
    await initAccountSettings(root);
    expect(button(root, /Disconnect/)).toBeUndefined();
    button(root, /^\s*Sign out\s*$/)!.click();
    expect(String(confirm.mock.calls[0][0])).toMatch(
      /Sign out on this browser\? Your settings stay here and in the cloud\./,
    );
  });

  it("an expired session offers Sign in again, through the notice the first time", async () => {
    await chrome.storage.local.set({ CLOUD_AUTH_FAILED: true });
    const root = document.createElement("div");
    await initAccountSettings(root);
    await settle();
    button(root, /Sign in again/)!.click();
    await vi.waitFor(() =>
      expect(root.querySelector("[data-disclosure]")).not.toBeNull(),
    );
    expect(tabs.sendMessage).not.toHaveBeenCalled();
  });
});
