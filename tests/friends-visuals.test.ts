/**
 * What the friends widget asks the network for in "intra" auth mode: the
 * public visuals in one batch (cached per login, skipped when custom avatars
 * are off), the cheaper "online" load for the closed widget, the deadlines on
 * every request, and the bounds on what is accepted from the cloud.
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
vi.mock("../src/features/account/account.ts", () => ({
  hashLogin: vi.fn(async (login: string) => `hashed-${login}`),
  getCloudLogin: vi.fn(async () => "me"),
}));
const intrapy = vi.hoisted(() => ({ token: "Bearer t" as string | null }));
vi.mock("../src/core/intra/intrapy.ts", () => ({
  waitForIntrapyToken: vi.fn(async () => intrapy.token),
}));

import {
  fetchFriendsIntraResult,
  INTRAPY_TIMEOUT_MS,
  VISUALS_BATCH_MAX,
  VISUALS_TIMEOUT_MS,
} from "../src/features/friends/friends-intra";
import {
  FRIENDS_CACHE_TTL,
  loadFriendsData,
} from "../src/features/friends/friends";
import {
  getCachedVisuals,
  setCachedVisuals,
  VISUALS_CACHE_FRESH_MS,
} from "../src/features/profile/header/visuals-cache";
import {
  MAX_REMOTE_URL_LENGTH,
  sanitizeHttpUrl,
} from "../src/core/security/safe-url";

type Call = { url: string; init?: RequestInit };
const calls: Call[] = [];
const worker = () => calls.filter((c) => c.url.startsWith("https://worker.test"));
const intra = (suffix: string) =>
  calls.filter((c) => c.url.startsWith("https://intrapy") && c.url.endsWith(suffix));

/** hash -> visuals object (or null) the batch route answers with. */
const batchVisuals = new Map<string, Record<string, unknown> | null>();
/** Status of the batch route: 200, 404 (old worker) or 500. */
let batchStatus = 200;
/** login -> what /users answers (a picture by default). */
const users = new Map<string, Record<string, unknown>>();

function userOf(login: string) {
  return (
    users.get(login) ?? {
      displayname: login,
      profile_picture: `https://cdn.intra.42.fr/${login}.jpg`,
      location: login === "alice" ? "e1r1p1" : null,
    }
  );
}

function fetchMock(url: string, init?: RequestInit) {
  calls.push({ url, init });
  if (url.startsWith("https://worker.test")) {
    const u = new URL(url);
    const many = u.searchParams.get("logins");
    if (many !== null) {
      if (batchStatus !== 200) return { ok: false, status: batchStatus, json: async () => ({}) };
      const visuals: Record<string, unknown> = {};
      for (const h of many.split(",")) visuals[h] = batchVisuals.get(h) ?? null;
      // an extra key the client never asked for
      visuals["hashed-stranger"] = { avatar: "https://i.imgur.com/stranger.png" };
      return { ok: true, status: 200, json: async () => ({ visuals }) };
    }
    const one = u.searchParams.get("login")!;
    return { ok: true, status: 200, json: async () => batchVisuals.get(one) ?? {} };
  }
  const m = url.match(/\/users\/([^/]+)(\/.*)?$/);
  const login = m ? decodeURIComponent(m[1]) : "";
  if (login === "ghost") return { ok: false, status: 404, json: async () => ({}) };
  const body =
    m?.[2] === "/cursus"
      ? [{ slug: "42cursus", level: 4.2, grade: "Learner" }]
      : m?.[2] === "/summary"
        ? { profile_picture: `https://cdn.intra.42.fr/${login}-summary.jpg` }
        : userOf(login);
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_TOKEN: "tok", CLOUD_LOGIN: "me" });
  intrapy.token = "Bearer t";
  calls.length = 0;
  batchVisuals.clear();
  users.clear();
  batchStatus = 200;
  vi.stubGlobal("fetch", vi.fn(fetchMock));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const twenty = Array.from({ length: 20 }, (_, i) => `user${i}`);

describe("custom avatars from the worker", () => {
  it("never contacts the worker when custom avatars are off", async () => {
    await chrome.storage.local.set({ SHOW_CUSTOM_AVATARS_IN_FRIENDS: false });
    const result = await fetchFriendsIntraResult(twenty);
    expect(result.friends).toHaveLength(20);
    expect(worker()).toHaveLength(0);
    expect(result.friends[0].customAvatar).toBeNull();
  });

  it("asks for the whole list in one request and applies the answer per login", async () => {
    batchVisuals.set("hashed-alice", {
      avatar: "https://i.imgur.com/alice.png",
      avatarBg: "#112233",
      avatarPosX: 30,
    });
    const result = await fetchFriendsIntraResult(["alice", "bob"]);
    expect(worker()).toHaveLength(1);
    expect(new URL(worker()[0].url).searchParams.get("logins")).toBe(
      "hashed-alice,hashed-bob",
    );
    const alice = result.friends.find((f) => f.login === "alice")!;
    expect(alice.customAvatar).toBe("https://i.imgur.com/alice.png");
    expect(alice).toMatchObject({ avatarBg: "#112233", avatarPosX: 30 });
    expect(result.friends.find((f) => f.login === "bob")!.customAvatar).toBeNull();
  });

  it("splits a long list into batches of at most 50 hashes", async () => {
    const many = Array.from({ length: 120 }, (_, i) => `u${i}`);
    await fetchFriendsIntraResult(many);
    const sizes = worker().map(
      (c) => new URL(c.url).searchParams.get("logins")!.split(",").length,
    );
    expect(sizes).toEqual([VISUALS_BATCH_MAX, VISUALS_BATCH_MAX, 20]);
  });

  it("falls back to one request per login on a worker without the batch route", async () => {
    batchStatus = 404;
    batchVisuals.set("hashed-bob", { avatar: "https://i.imgur.com/bob.png" });
    const result = await fetchFriendsIntraResult(["alice", "bob"]);
    const urls = worker().map((c) => new URL(c.url));
    expect(urls.filter((u) => u.searchParams.has("logins"))).toHaveLength(1);
    expect(urls.filter((u) => u.searchParams.has("login")).map((u) => u.searchParams.get("login")))
      .toEqual(["hashed-alice", "hashed-bob"]);
    expect(result.friends.find((f) => f.login === "bob")!.customAvatar).toBe(
      "https://i.imgur.com/bob.png",
    );
  });

  it("still builds the friends when the worker fails, and caches nothing", async () => {
    batchStatus = 500;
    const result = await fetchFriendsIntraResult(["alice"]);
    expect(result.friends.map((f) => f.login)).toEqual(["alice"]);
    expect(result.friends[0].customAvatar).toBeNull();
    expect(await getCachedVisuals("alice")).toBeNull();
  });

  it("serves a recent answer from the per-login cache, including 'no visuals'", async () => {
    batchVisuals.set("hashed-alice", { avatar: "https://i.imgur.com/alice.png" });
    await fetchFriendsIntraResult(["alice", "bob"]);
    expect(worker()).toHaveLength(1);
    const alice = await getCachedVisuals("alice");
    expect(alice?.avatar).toBe("https://i.imgur.com/alice.png");
    expect(typeof alice?.fetchedAt).toBe("number");
    // bob has no cloud visuals: remembered too, so he is not asked about again
    expect((await getCachedVisuals("bob"))?.avatar).toBe("");

    calls.length = 0;
    const again = await fetchFriendsIntraResult(["alice", "bob"]);
    expect(worker()).toHaveLength(0);
    expect(again.friends.find((f) => f.login === "alice")!.customAvatar).toBe(
      "https://i.imgur.com/alice.png",
    );
  });

  it("refetches only the logins whose cached answer is too old", async () => {
    const old = { ...(await freshRecord()), fetchedAt: Date.now() - VISUALS_CACHE_FRESH_MS - 1 };
    await chrome.storage.local.set({ visuals_cache_alice: old });
    setCachedVisuals("bob", await freshRecord());
    await fetchFriendsIntraResult(["alice", "bob"]);
    expect(worker()).toHaveLength(1);
    expect(new URL(worker()[0].url).searchParams.get("logins")).toBe("hashed-alice");
  });

  it("ignores logins it did not ask for and refuses oversize strings", async () => {
    const huge = `https://x.example/${"a".repeat(5000)}`;
    batchVisuals.set("hashed-alice", { avatar: huge, avatarBg: "#".padEnd(3000, "f") });
    const result = await fetchFriendsIntraResult(["alice"]);
    expect(result.friends[0].customAvatar).toBeNull();
    expect(result.friends[0].avatarBg).toBe("transparent");
    expect((await getCachedVisuals("alice"))?.avatar).toBe("");
    expect(await getCachedVisuals("stranger")).toBeNull();
  });
});

async function freshRecord() {
  const { sanitizeVisualUrls } = await import(
    "../src/features/profile/header/visuals-sanitize"
  );
  return sanitizeVisualUrls({
    avatar: "",
    banner: "",
    bannerMode: "fill",
    background: "",
    backgroundMode: "fill",
  });
}

describe("the 'online' load", () => {
  it("only asks /users, and keeps the known level and avatars", async () => {
    users.set("alice", { displayname: "Alice", location: "e1r1p1" }); // no picture
    const known = (await fetchFriendsIntraResult(["alice"])).friends[0];
    expect(known.level).toBe(4.2);
    known.customAvatar = "https://i.imgur.com/alice.png";
    calls.length = 0;

    const result = await fetchFriendsIntraResult(["alice", "bob"], {
      detail: "online",
      known: [known],
    });
    expect(intra("/cursus")).toHaveLength(0);
    expect(intra("/summary")).toHaveLength(0);
    expect(worker()).toHaveLength(0);
    const alice = result.friends.find((f) => f.login === "alice")!;
    expect(alice.isOnline).toBe(true);
    expect(alice).toMatchObject({
      level: 4.2,
      grade: "Learner",
      avatar: known.avatar,
      customAvatar: "https://i.imgur.com/alice.png",
    });
    // never seen before: what /users gives, nothing invented
    expect(result.friends.find((f) => f.login === "bob")).toMatchObject({
      level: 0,
      customAvatar: null,
    });
  });

  it("still tells an unknown login apart", async () => {
    const result = await fetchFriendsIntraResult(["ghost"], { detail: "online" });
    expect(result).toEqual({ friends: [], notFound: ["ghost"], failed: [] });
    expect(intra("/summary")).toHaveLength(1);
  });
});

describe("loadFriendsData stages", () => {
  it("keeps the cache five minutes in intra mode", () => {
    expect(FRIENDS_CACHE_TTL).toBe(5 * 60_000);
  });

  it("serves an 'online' cache to the closed widget, not to the open panel", async () => {
    const first = await loadFriendsData(["alice", "bob"], { detail: "online" });
    expect(first.detail).toBe("online");
    expect(intra("/cursus")).toHaveLength(0);
    calls.length = 0;

    const closed = await loadFriendsData(["alice", "bob"], { detail: "online" });
    expect(closed.detail).toBe("online");
    expect(calls).toHaveLength(0);

    const open = await loadFriendsData(["alice", "bob"]);
    expect(open.detail).toBe("full");
    expect(intra("/cursus")).toHaveLength(2);
    expect(worker()).toHaveLength(1);
    calls.length = 0;

    // a full cache serves both
    expect((await loadFriendsData(["alice", "bob"], { detail: "online" })).detail).toBe("full");
    expect((await loadFriendsData(["alice", "bob"])).detail).toBe("full");
    expect(calls).toHaveLength(0);
  });

  it("does not serve a cache written with custom avatars off once they are on", async () => {
    await chrome.storage.local.set({ SHOW_CUSTOM_AVATARS_IN_FRIENDS: false });
    await loadFriendsData(["alice"]);
    expect(worker()).toHaveLength(0);
    calls.length = 0;

    await chrome.storage.local.set({ SHOW_CUSTOM_AVATARS_IN_FRIENDS: true });
    const result = await loadFriendsData(["alice"]);
    expect(result.detail).toBe("full");
    expect(worker()).toHaveLength(1);
  });
});

describe("deadlines and storage failures", () => {
  it("gives every request a deadline", async () => {
    await fetchFriendsIntraResult(["alice"]);
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) expect(c.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("lists a login whose requests hang as failed, without trying /summary", async () => {
    const requested: number[] = [];
    // AbortSignal.timeout runs on an internal timer: shortened, not waited for.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      requested.push(ms);
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), 10);
      return controller.signal;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        });
      }),
    );
    const result = await fetchFriendsIntraResult(["bob"]);
    expect(result).toEqual({ friends: [], notFound: [], failed: ["bob"] });
    expect(intra("/summary")).toHaveLength(0);
    expect(requested).toContain(INTRAPY_TIMEOUT_MS);
    expect(requested).toContain(VISUALS_TIMEOUT_MS);
  });

  it("returns the friends when the 'last seen' stamps cannot be stored", async () => {
    const set = chrome.storage.local.set as ReturnType<typeof vi.fn>;
    const real = set.getMockImplementation()!;
    set.mockImplementation(async (items: Record<string, unknown>) => {
      if ("FRIENDS_LAST_ONLINE" in items) throw new Error("QUOTA_BYTES");
      return real(items);
    });
    try {
      const result = await fetchFriendsIntraResult(["alice"]);
      expect(result.friends.map((f) => f.login)).toEqual(["alice"]);
    } finally {
      set.mockImplementation(real);
    }
  });
});

describe("bounds on remote strings", () => {
  it("sanitizeHttpUrl refuses a URL past the shared bound", () => {
    const base = "https://cdn.example/";
    const ok = base + "a".repeat(MAX_REMOTE_URL_LENGTH - 1 - base.length);
    expect(ok).toHaveLength(MAX_REMOTE_URL_LENGTH - 1);
    expect(sanitizeHttpUrl(ok)).toBe(ok);
    expect(sanitizeHttpUrl(ok + "aa")).toBe("");
  });
});
