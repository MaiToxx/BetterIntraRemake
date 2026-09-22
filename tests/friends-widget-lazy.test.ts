/**
 * The friends widget's loading behaviour on a profile page ("intra" auth
 * mode): the closed widget only fetches what its badge needs and completes
 * the rows when it opens, the last cached rows are painted before the fetch,
 * changes to the saved list made elsewhere reach the open widget, and a load
 * that throws still ends in the error state instead of a skeleton for good.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/core/worker.ts", () => ({
  WORKER_URL: "https://worker.test",
  WORKER_HOST: "worker.test",
  WORKER_ORIGIN_PATTERN: "https://worker.test/*",
  AUTH_MODE: "intra",
}));
vi.mock("../src/core/crypto.ts", () => ({
  hashLogin: vi.fn(async (login: string) => `hashed-${login}`),
}));
const mocks = vi.hoisted(() => ({
  token: "Bearer t" as string | null,
  /** Rejections loadFriendsData must produce, one per call, in order. */
  loadFailures: [] as Error[],
}));
vi.mock("../src/features/account/account.ts", () => ({
  hashLogin: async (login: string) => `hashed-${login}`,
  getCloudLogin: async () => "me",
  loginWith42: () => {},
  clearAuthFailed: async () => {},
  syncToCloud: async () => true,
}));
vi.mock("../src/core/intra/intrapy.ts", () => ({
  waitForIntrapyToken: async () => mocks.token,
}));
vi.mock("../src/features/clusters/clusters.data.ts", () => ({
  CLUSTERS: [],
  getClusterData: async () => ({ clusters: [], screens: {} }),
}));
vi.mock("../src/features/friends/friends.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/features/friends/friends")>();
  return {
    ...actual,
    loadFriendsData: async (...args: Parameters<typeof actual.loadFriendsData>) => {
      const failure = mocks.loadFailures.shift();
      if (failure) throw failure;
      return actual.loadFriendsData(...args);
    },
  };
});

type Listener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void;
const listeners: Listener[] = [];

const calls: string[] = [];
const intra = (suffix: string) =>
  calls.filter((c) => c.startsWith("https://intrapy") && c.endsWith(suffix));
const worker = () => calls.filter((c) => c.startsWith("https://worker.test"));
/** Requests held back until release() is called. */
let held: (() => void)[] = [];
let holdIntrapy = false;

async function mount(): Promise<ShadowRoot> {
  vi.resetModules();
  const { injectFriendsWidget } = await import("../src/features/friends/friends.ui");
  await injectFriendsWidget();
  return shadow();
}
function shadow(): ShadowRoot {
  const host = document.getElementById("friends-widget-host");
  if (!host?.shadowRoot) throw new Error("widget not mounted");
  return host.shadowRoot;
}

const fab = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>(".friends-fab button")!;
const rowLogins = (root: ShadowRoot) =>
  [...root.querySelectorAll(".list-row .text-primary")].map((e) => e.textContent);
const badge = (root: ShadowRoot) =>
  root.querySelector(".friends-fab .indicator-item")?.textContent ?? null;
const text = (root: ShadowRoot) => root.textContent ?? "";
const refreshing = (root: ShadowRoot) =>
  root.querySelector('button[aria-label="Refresh friends"].loading') !== null;
const settled = (root: ShadowRoot) =>
  vi.waitFor(() => expect(refreshing(root)).toBe(false));

function row(login: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    login,
    displayName: login.toUpperCase(),
    avatar: `https://cdn.intra.42.fr/${login}.jpg`,
    customAvatar: null,
    level: 7,
    grade: "Member",
    isOnline: login === "alice",
    lastSeen: login === "alice" ? "e1r1p1" : null,
    poolLabel: null,
    wallet: 3,
    correctionPoints: 2,
    lastOnlineTimestamp: null,
    ...extra,
  };
}

beforeEach(async () => {
  document.body.replaceChildren();
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    CLOUD_TOKEN: "tok",
    CLOUD_LOGIN: "me",
    FRIENDS_LIST: JSON.stringify(["alice", "bob"]),
  });
  mocks.token = "Bearer t";
  mocks.loadFailures = [];
  calls.length = 0;
  held = [];
  holdIntrapy = false;
  listeners.length = 0;
  (chrome.storage as unknown as Record<string, unknown>).onChanged = {
    addListener: (fn: Listener) => listeners.push(fn),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://worker.test")) {
        return { ok: true, status: 200, json: async () => ({ visuals: {} }) };
      }
      if (holdIntrapy) await new Promise<void>((r) => held.push(r));
      const m = url.match(/\/users\/([^/]+)(\/.*)?$/);
      const login = m ? decodeURIComponent(m[1]) : "";
      const body =
        m?.[2] === "/cursus"
          ? [{ slug: "42cursus", level: 4.5, grade: "Learner" }]
          : {
              displayname: login,
              profile_picture: `https://cdn.intra.42.fr/${login}.jpg`,
              location: login === "alice" ? "e1r1p1" : null,
            };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (chrome.storage as unknown as Record<string, unknown>).onChanged;
});

describe("the closed widget", () => {
  it("only fetches what the online badge needs, and completes the rows on open", async () => {
    const root = await mount();
    expect(badge(root)).toBe("1");
    expect(intra("/users/alice")).toHaveLength(1);
    expect(intra("/cursus")).toHaveLength(0);
    expect(worker()).toHaveLength(0);

    fab(root).click();
    await settled(root);
    expect(intra("/cursus")).toHaveLength(2);
    expect(worker()).toHaveLength(1);
    expect(text(root)).toContain("Learner");

    // opening again costs nothing: the rows are complete
    fab(root).click();
    fab(root).click();
    await settled(root);
    expect(intra("/cursus")).toHaveLength(2);
  });

  it("leaves the closed panel out of the render tree, with the fade kept", () => {
    return mount().then((root) => {
      const css = [...root.querySelectorAll("style")].map((s) => s.textContent).join("\n");
      const closed = css.match(/\.friends-dropdown\.closed\s*\{[^}]*\}/)?.[0] ?? "";
      expect(closed).toMatch(/display:\s*none/);
      expect(css).toMatch(/display\s+[\d.]+s\s+allow-discrete/);
      expect(css).toContain("@starting-style");
    });
  });

  it("does not run a layout probe or log on render", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const root = await mount();
    fab(root).click();
    root.querySelector<HTMLButtonElement>('button[aria-label="Add friend"]')!.click();
    const input = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.value = "x";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(debug).not.toHaveBeenCalled();
  });
});

describe("the stale cache", () => {
  it("is painted, badge included, while the fetch runs, then replaced", async () => {
    await chrome.storage.local.set({
      FRIENDS_DATA_CACHE: {
        data: [row("alice", { wallet: 99 }), row("bob"), row("gone")],
        timestamp: Date.now() - 60 * 60_000,
        logins: ["alice", "bob", "gone"],
      },
    });
    holdIntrapy = true;
    vi.resetModules();
    const { injectFriendsWidget } = await import("../src/features/friends/friends.ui");
    const mounted = injectFriendsWidget();

    await vi.waitFor(() => expect(rowLogins(shadow())).toEqual(["alice", "bob"]));
    const root = shadow();
    expect(root.querySelector(".friends-list")!.textContent).toContain("99");
    expect(badge(root)).toBe("1");
    expect(refreshing(root)).toBe(true);
    expect(root.querySelector(".friends-list .loading-spinner")).toBeNull();
    // the removed friend never comes back from the seed
    expect(rowLogins(root)).not.toContain("gone");

    holdIntrapy = false;
    held.forEach((release) => release());
    await mounted;
    await settled(root);
    expect(rowLogins(root)).toEqual(["alice", "bob"]);
    // the fetched row replaced the seeded one
    const list = root.querySelector(".friends-list")!.textContent ?? "";
    expect(list).not.toContain("99");
  });
});

describe("the saved list changes outside the widget", () => {
  const change = (list: string[]) =>
    listeners.forEach((fn) =>
      fn({ FRIENDS_LIST: { newValue: JSON.stringify(list) } }, "local"),
    );

  it("shows a friend added from their profile page", async () => {
    const root = await mount();
    fab(root).click();
    await settled(root);
    await chrome.storage.local.set({ FRIENDS_LIST: JSON.stringify(["alice", "bob", "carol"]) });
    change(["alice", "bob", "carol"]);
    await vi.waitFor(() => expect(rowLogins(root)).toContain("carol"));
    expect(intra("/users/carol")).toHaveLength(1);
  });

  it("drops a friend removed elsewhere without a fetch, and ignores a list it already shows", async () => {
    const root = await mount();
    fab(root).click();
    await settled(root);
    const before = calls.length;
    await chrome.storage.local.set({ FRIENDS_LIST: JSON.stringify(["alice"]) });
    change(["alice"]);
    expect(rowLogins(root)).toEqual(["alice"]);
    change(["alice"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(before);
  });
});

describe("a load that throws", () => {
  it("ends in the error state with Retry, and the retry works", async () => {
    mocks.loadFailures.push(new Error("storage is gone"));
    const root = await mount();
    expect(text(root)).toContain("Could not load your friends");
    expect(root.querySelector(".friends-list .loading-spinner")).toBeNull();
    expect(refreshing(root)).toBe(false);

    [...root.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === "Retry")!
      .click();
    await vi.waitFor(() => expect(rowLogins(root)).toEqual(["alice", "bob"]));
    expect(text(root)).not.toContain("Could not load");
  });

  it("still closes the panel on an outside click after the first load failed", async () => {
    mocks.loadFailures.push(new Error("boom"));
    const root = await mount();
    fab(root).click();
    expect(root.querySelector(".friends-dropdown")!.hasAttribute("inert")).toBe(false);
    document.body.click();
    expect(root.querySelector(".friends-dropdown")!.hasAttribute("inert")).toBe(true);
  });
});
