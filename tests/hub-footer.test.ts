/**
 * The footer of the settings hub: the cloud account entry (Connect with 42
 * when signed out, Connected as + Sign out when signed in), the push mode,
 * and what the hub says about a change: "Reload to apply" for a setting the
 * page applies at the next load, one automatic push per burst of changes
 * when Auto push is on, and a failed push reported instead of swallowed by
 * the reload.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

vi.mock("../src/features/hub/controls/context.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/features/hub/controls/context.ts")>()),
  loadLiveOptions: vi.fn(async () => ({ campuses: [], eventTypes: [] })),
}));

const account = {
  clearAuthFailed: vi.fn(async () => {}),
  loginWith42: vi.fn(async () => {}),
  logoutCloud: vi.fn(async () => true),
  syncToCloud: vi.fn(async () => true),
};
vi.mock("../src/features/account/account.ts", () => account);

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const listeners: Listener[] = [];
const reload = vi.fn();

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
  (chrome.storage as unknown as { onChanged: unknown }).onChanged = {
    addListener: (fn: Listener) => listeners.push(fn),
    removeListener: vi.fn(),
  };
  const url = new URL("https://profile-v3.intra.42.fr/");
  const loc = {
    href: url.href,
    protocol: url.protocol,
    hostname: url.hostname,
    host: url.host,
    origin: url.origin,
    pathname: url.pathname,
    search: "",
    hash: "",
    reload,
  };
  Object.defineProperty(window, "location", { value: loc, writable: true, configurable: true });
  Object.defineProperty(globalThis, "location", { value: loc, writable: true, configurable: true });
});

// the first import of the hub pulls in every tab module: not on a test's clock
beforeAll(async () => {
  await import("../src/features/hub/hubSettings.ui.ts");
}, 30000);

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

/** A fresh hub for the stored state: the module builds it once per document. */
async function openHub(): Promise<{ dialog: HTMLDialogElement; shadow: ShadowRoot }> {
  document.getElementById("hub-dialog")?.remove();
  const { openHubModal } = await import("../src/features/hub/hubSettings.ui.ts");
  await openHubModal(["profile", "logtime"]);
  await settle();
  const dialog = document.getElementById("hub-dialog") as HTMLDialogElement;
  return { dialog, shadow: dialog.querySelector("#hub-shadow-wrapper")!.shadowRoot! };
}

/** What chrome.storage.onChanged would deliver for one write. */
function storageChanged(changes: Record<string, unknown>) {
  const payload = Object.fromEntries(
    Object.entries(changes).map(([k, v]) => [k, { newValue: v }]),
  );
  for (const fn of listeners) fn(payload, "local");
}

/** The buttons of the footer (the Calendar card has a Connect button of its own). */
const buttons = (shadow: ShadowRoot) =>
  [...shadow.querySelectorAll("#hub-footer button, .alert button")].map((b) =>
    b.textContent!.replace(/\s+/g, " ").trim(),
  );

beforeEach(async () => {
  await chrome.storage.local.clear();
  listeners.length = 0;
  reload.mockClear();
  account.syncToCloud.mockClear();
  account.syncToCloud.mockImplementation(async () => true);
  account.loginWith42.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cloud account entry", () => {
  it("signed out: the footer offers Connect with 42, and it starts the login", async () => {
    const { dialog, shadow } = await openHub();
    expect(buttons(shadow)).toContain("Connect with 42");
    expect(buttons(shadow)).not.toContain("Sign out");
    // nothing that is not a button looks like one any more
    expect(shadow.querySelector("#hub-footer span.btn")).toBeNull();

    const connect = [...shadow.querySelectorAll("#hub-footer button")].find(
      (b) => b.textContent!.trim() === "Connect with 42",
    ) as HTMLButtonElement;
    connect.click();
    expect(dialog.open).toBe(false);
    expect(account.loginWith42).toHaveBeenCalledTimes(1);
  });

  it("signed in: Connected as <login> and a Sign out, no Connect button", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "xlogin" });
    const { shadow } = await openHub();
    expect(buttons(shadow)).not.toContain("Connect with 42");
    expect(buttons(shadow)).toContain("Sign out");
    expect(shadow.textContent).toContain("Connected as xlogin");
  });

  it("expired token: only the banner's Reconnect starts a login", async () => {
    await chrome.storage.local.set({ CLOUD_AUTH_FAILED: true });
    const { shadow } = await openHub();
    expect(buttons(shadow)).toContain("Reconnect");
    expect(buttons(shadow)).not.toContain("Connect with 42");
  });

  it("the sync badge says when, with the day once it is not today", async () => {
    const { formatSyncStatus } = await import("../src/features/hub/hubSettings.ui.ts");
    const now = new Date(2026, 8, 22, 15, 0);
    expect(formatSyncStatus(null, now)).toBe("Never synced");
    expect(formatSyncStatus("garbage", now)).toBe("Never synced");
    expect(formatSyncStatus(new Date(2026, 8, 22, 14, 3).getTime(), now)).toMatch(
      /^Synced at \d{2}:\d{2}$/,
    );
    const older = formatSyncStatus(new Date(2026, 8, 12, 14, 3).getTime(), now);
    expect(older).toMatch(/^Synced /);
    expect(older).toContain("12");
    expect(older).not.toMatch(/^Synced at/);
  });
});

describe("reload hint", () => {
  it("a setting the page does not apply live lights up 'Reload to apply'", async () => {
    const { shadow } = await openHub();
    const hint = shadow.querySelector<HTMLElement>("#hub-reload-hint")!;
    expect(hint.classList.contains("hidden")).toBe(true);
    storageChanged({ LOGTIME_SHOW_AVERAGE: false });
    expect(hint.classList.contains("hidden")).toBe(false);
    expect(hint.textContent).toBe("Reload to apply");
    expect(shadow.querySelector("#hub-reload")!.classList.contains("btn-warning")).toBe(true);
  });

  it("a live setting (Customize) leaves it hidden", async () => {
    const { shadow } = await openHub();
    storageChanged({ CUSTOM_HIDE_FOOTER: true, BETTER_INTRA_THEME: "light" });
    expect(shadow.querySelector("#hub-reload-hint")!.classList.contains("hidden")).toBe(true);
  });

  it("the session and the caches are not settings: no hint", async () => {
    const { shadow } = await openHub();
    storageChanged({ LAST_CLOUD_SYNC: 1, CLOUD_SYNC_ENABLED: true, CAMPUS_DATA_1: {} });
    expect(shadow.querySelector("#hub-reload-hint")!.classList.contains("hidden")).toBe(true);
  });

  it("the cards say which settings need the reload", async () => {
    const { shadow } = await openHub();
    const tag = (key: string) =>
      shadow
        .querySelector(`[data-setting-key="${key}"]`)!
        .closest(".card")!
        .querySelector(".badge")?.textContent?.trim();
    expect(tag("LOGTIME_SHOW_AVERAGE")).toBe("reload");
    expect(tag("CUSTOM_HIDE_FOOTER")).toBeUndefined();
  });
});

describe("auto push", () => {
  async function openAuto() {
    await chrome.storage.local.set({
      CLOUD_TOKEN: "t",
      CLOUD_LOGIN: "xlogin",
      CLOUD_SYNC_ENABLED: true,
    });
    return openHub();
  }

  it("pushes once, one second after the last of a burst of changes", async () => {
    const { shadow } = await openAuto();
    vi.useFakeTimers();
    storageChanged({ LOGTIME_GOAL_HOURS: 100 });
    storageChanged({ LOGTIME_GOAL_HOURS: 110 });
    storageChanged({ LOGTIME_GOAL_HOURS: 120 });
    await vi.advanceTimersByTimeAsync(900);
    expect(account.syncToCloud).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(account.syncToCloud).toHaveBeenCalledTimes(1);
    expect(shadow.querySelector("#hub-push-status")!.textContent).toMatch(/Pushed/);
  });

  it("does nothing with Manual push, or for a key that never leaves the device", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", CLOUD_LOGIN: "x" });
    await openHub();
    vi.useFakeTimers();
    storageChanged({ LOGTIME_GOAL_HOURS: 100 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(account.syncToCloud).not.toHaveBeenCalled();
  });

  it("reports a failed push in the footer", async () => {
    account.syncToCloud.mockImplementation(async () => false);
    const { shadow } = await openAuto();
    vi.useFakeTimers();
    storageChanged({ LOGTIME_GOAL_HOURS: 100 });
    await vi.advanceTimersByTimeAsync(1100);
    const status = shadow.querySelector("#hub-push-status")!;
    expect(status.textContent).toMatch(/Push failed/);
    expect(status.classList.contains("text-error")).toBe(true);
  });

  it("Reload with an unpushed change pushes first, and stays on a failure", async () => {
    account.syncToCloud.mockImplementation(async () => false);
    const { shadow } = await openAuto();
    storageChanged({ LOGTIME_GOAL_HOURS: 100 });
    (shadow.querySelector("#hub-reload") as HTMLButtonElement).click();
    await settle();
    expect(account.syncToCloud).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(shadow.querySelector("#hub-push-status")!.textContent).toMatch(/Push failed/);

    account.syncToCloud.mockImplementation(async () => true);
    (shadow.querySelector("#hub-reload") as HTMLButtonElement).click();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("closing the hub flushes a pending push", async () => {
    const { dialog } = await openAuto();
    vi.useFakeTimers();
    storageChanged({ LOGTIME_GOAL_HOURS: 100 });
    dialog.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(account.syncToCloud).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(account.syncToCloud).toHaveBeenCalledTimes(1);
  });
});
