/**
 * Three entries of Chrome's error list for the extension (1.17.0):
 * - "<svg> attribute height: Expected length, 'auto'": the give-points icon
 *   was a clone of the Intra's own svg, which carries height="auto";
 * - "Uncaught (in promise) Error: Extension context invalidated": the old
 *   script Chrome keeps running in a tab opened before an update;
 * - "Cloud sync failed: 429": a handled failure logged as an error, after
 *   pushes that could have been one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/features/profile/header/profile.modal.ts", () => ({ createSettingsModal: vi.fn() }));
vi.mock("../src/features/clusters/map-dialog.ts", () => ({ openClusterDialog: vi.fn() }));
vi.mock("../src/features/clusters/clusters.data.ts", () => ({
  CLUSTERS: [{ name: "k1" }],
  getClusterData: async () => ({ clusters: [] }),
}));
vi.mock("../src/features/profile/header/personal-info.ts", () => ({
  initShortcutButtons: async () => {},
  initFriendBadge: async () => {},
}));
vi.mock("../src/features/campus/campus-flags.ts", () => ({ injectCampusFlag: () => {} }));

import { installOrphanErrorFilter, isOrphanError } from "../src/core/lifecycle/orphan-errors.ts";

/** A profile card like the Intra's, its give-points svg sized height="auto". */
function intraCardWithGiveButton(): SVGSVGElement {
  const card = document.createElement("div");
  const row = document.createElement("div");
  row.className = "flex flex-col lg:flex-row";
  const login = document.createElement("p");
  login.setAttribute("class", "text-sm");
  login.textContent = "someone";
  row.appendChild(login);
  card.appendChild(row);
  const stats = document.createElement("div");
  stats.className = "border-t-neutral-600";
  for (const [label, value] of [
    ["Wallet ₳", "120"],
    ["Ev.P", "5"],
    ["Grade", "Member"],
  ]) {
    const item = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = label;
    const s = document.createElement("span");
    s.textContent = value;
    item.append(b, s);
    stats.appendChild(item);
  }
  const give = document.createElement("button");
  give.setAttribute("aria-haspopup", "dialog");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "auto");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "text-white");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M1 1h22v22H1z");
  svg.appendChild(path);
  give.appendChild(svg);
  stats.appendChild(give);
  card.appendChild(stats);
  const pill = document.createElement("div");
  pill.className = "absolute px-2 py-1 border rounded-full border-neutral-600 bg-ft-gray top-2 right-4";
  pill.textContent = "k1r2p3";
  card.appendChild(pill);
  document.body.appendChild(card);
  return svg;
}

describe("the give-points icon", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
  });

  it("is rebuilt with real lengths, its shapes and attributes kept", async () => {
    intraCardWithGiveButton();
    const { initProfileCardStyling } = await import("../src/features/profile/header/profile-card.ts");
    await initProfileCardStyling();
    const root = document.getElementById("profile-badges-shadow")!.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector("[data-ft-give-points] svg")).not.toBeNull());
    const icon = root.querySelector("[data-ft-give-points] svg")!;
    expect(icon.getAttribute("height")).toBe("20");
    expect(icon.getAttribute("width")).toBe("20");
    expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon.getAttribute("class")).toBe("text-white");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.querySelector("path")?.getAttribute("d")).toBe("M1 1h22v22H1z");
  });
});

describe("the orphaned script's rejections", () => {
  it("are recognised, and nothing else is", () => {
    expect(isOrphanError(new Error("Extension context invalidated."))).toBe(true);
    expect(isOrphanError("Extension context invalidated.")).toBe(true);
    expect(isOrphanError(new Error("Failed to fetch"))).toBe(false);
    expect(isOrphanError(undefined)).toBe(false);
  });

  it("are kept out of the error list; other rejections still reach it", () => {
    const target = new EventTarget() as unknown as Window;
    installOrphanErrorFilter(target);
    const event = (reason: unknown) => {
      const e = new Event("unhandledrejection", { cancelable: true });
      Object.defineProperty(e, "reason", { value: reason });
      target.dispatchEvent(e);
      return e;
    };
    expect(event(new Error("Extension context invalidated.")).defaultPrevented).toBe(true);
    expect(event(new Error("something real")).defaultPrevented).toBe(false);
  });
});

describe("automatic pushes", () => {
  const posts: number[] = [];
  let status = 200;

  beforeEach(async () => {
    vi.useFakeTimers();
    posts.length = 0;
    status = 200;
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ CLOUD_TOKEN: "sess", CLOUD_LOGIN: "alice" });
    (globalThis as any).fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (init?.method === "POST") posts.push(Date.now());
      return new Response(status === 200 ? "Saved" : "Too many requests, retry in a minute", { status });
    });
    vi.resetModules();
  });
  afterEach(() => vi.useRealTimers());

  it("run one at a time: requests made during a push share one more push", async () => {
    const { syncToCloud } = await import("../src/features/account/account.ts");
    const all = [syncToCloud(), syncToCloud(), syncToCloud(), syncToCloud()];
    await expect(Promise.all(all)).resolves.toEqual([true, true, true, true]);
    expect(posts).toHaveLength(2);
  });

  it("a 429 is not logged as an error, and is tried again once the minute is over", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { syncToCloud } = await import("../src/features/account/account.ts");
    status = 429;
    await expect(syncToCloud()).resolves.toBe(false);
    expect(error).not.toHaveBeenCalled();
    expect(posts).toHaveLength(1);
    status = 200;
    await vi.advanceTimersByTimeAsync(64_000);
    expect(posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(posts).toHaveLength(2);
    error.mockRestore();
  });

  it("with Auto push on, a look change made in the hub is left to the hub's own push", async () => {
    // real timers: the push hashes the login with SubtleCrypto, which fake
    // timers do not drive
    vi.useRealTimers();
    await chrome.storage.local.set({ CLOUD_SYNC_ENABLED: true, CUSTOM_SHARE_LOOK: true });
    const { publishLookIfShared, LOOK_PUBLISH_DELAY_MS } = await import(
      "../src/features/customize/publish.ts"
    );
    publishLookIfShared("CUSTOM_ACCENT_COLOR");
    await new Promise((r) => setTimeout(r, LOOK_PUBLISH_DELAY_MS + 300));
    expect(posts).toHaveLength(0);
    // Manual push: this is the one push that publishes the look
    await chrome.storage.local.set({ CLOUD_SYNC_ENABLED: false });
    publishLookIfShared("CUSTOM_ACCENT_COLOR");
    await vi.waitFor(() => expect(posts).toHaveLength(1), { timeout: LOOK_PUBLISH_DELAY_MS + 4_000 });
  });

});
