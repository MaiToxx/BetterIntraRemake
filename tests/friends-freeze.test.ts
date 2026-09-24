/**
 * A frozen friend in the friends widget. The cursus payload the widget
 * already downloads for the level carries `freeze_until`; it was dropped, so
 * a friend frozen for two months just looked offline with a stale "last
 * seen". The row now says until when, with no extra request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "lit-html";

vi.mock("../src/core/crypto.ts", () => ({
  hashLogin: vi.fn(async (login: string) => `hashed-${login}`),
}));
const intrapy = vi.hoisted(() => ({ token: "Bearer t" as string | null }));
vi.mock("../src/core/intra/intrapy.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/core/intra/intrapy.ts")>()),
  waitForIntrapyToken: vi.fn(async () => intrapy.token),
}));

import {
  buildFriendFromIntra,
  fetchFriendsIntraResult,
  freezeEnd,
} from "../src/features/friends/friends-intra";
import { renderFriendRow } from "../src/features/friends/friend-row";
import type { FriendData } from "../src/features/friends/friends-types";

const NOW = new Date("2026-09-24T12:00:00Z");
// midday UTC: the same calendar day in every timezone the tests may run in
const LATER = "2026-12-01T12:00:00.000Z";
const PAST = "2026-08-01T00:00:00.000Z";

function row(friend: FriendData): HTMLElement {
  const host = document.createElement("div");
  render(
    renderFriendRow(friend, {
      rank: -1,
      showCustomAvatars: false,
      deleteMode: false,
      selected: false,
      onAvatarToggle() {},
    }),
    host,
  );
  return host;
}

const meta = (host: HTMLElement) =>
  host.querySelector('[data-ft-row="meta"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "";

function friend(extra: Partial<FriendData> = {}): FriendData {
  return {
    ...buildFriendFromIntra("frosty", { displayname: "Frosty" }, null, [], null),
    lastOnlineTimestamp: NOW.getTime() - 21 * 86_400_000,
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("freezeEnd", () => {
  it("takes a running freeze from any cursus entry, not just the main one", () => {
    const cursus = [
      { slug: "42cursus", level: 3, freeze_until: null },
      { slug: "c-piscine", level: 5, freeze_until: LATER },
    ];
    expect(freezeEnd(cursus)).toBe(LATER);
    expect(buildFriendFromIntra("a", null, null, cursus, null).freezeUntil).toBe(LATER);
  });

  it("ignores a freeze that is over, a bad date and a bad payload", () => {
    expect(freezeEnd([{ freeze_until: PAST }])).toBeNull();
    expect(freezeEnd([{ freeze_until: "soon" }])).toBeNull();
    expect(freezeEnd("garbage")).toBeNull();
    expect(freezeEnd([null, 42])).toBeNull();
  });

  it("keeps the latest when several run", () => {
    const sooner = "2026-10-15T00:00:00.000Z";
    expect(freezeEnd([{ freeze_until: sooner }, { freeze_until: LATER }])).toBe(LATER);
  });
});

describe("the friend row", () => {
  it("says until when an offline friend is frozen, in place of last seen", () => {
    const host = row(friend({ freezeUntil: LATER }));
    const badge = host.querySelector("[data-ft-freeze]")!;
    expect(badge.textContent).toContain("Frozen until Dec 1");
    expect(badge.querySelector('[aria-hidden="true"]')!.textContent).toBe("❄");
    expect(meta(host)).not.toContain("ago");
  });

  it("adds the year when the freeze ends next year", () => {
    const host = row(friend({ freezeUntil: "2027-02-10T12:00:00.000Z" }));
    expect(host.querySelector("[data-ft-freeze]")!.textContent).toContain("Feb 10, 2027");
  });

  it("shows last seen again once the freeze is over, and nothing for an online friend", () => {
    expect(row(friend({ freezeUntil: PAST })).querySelector("[data-ft-freeze]")).toBeNull();
    expect(meta(row(friend({ freezeUntil: PAST })))).toContain("ago");
    const online = row(friend({ freezeUntil: LATER, isOnline: true, lastSeen: "e1r1s1" }));
    expect(online.querySelector("[data-ft-freeze]")).toBeNull();
    expect(meta(online)).toContain("e1r1s1");
  });

  it("renders older cached rows without the field as before", () => {
    const old = friend();
    delete old.freezeUntil;
    expect(row(old).querySelector("[data-ft-freeze]")).toBeNull();
    expect(meta(row(old))).toContain("ago");
  });
});

describe("fetching", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  function stubIntrapy(calls: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const m = url.match(/\/users\/([^/]+)(\/.*)?$/);
        const body =
          m?.[2] === "/cursus"
            ? [{ slug: "42cursus", level: 4.2, grade: "Learner", freeze_until: LATER }]
            : { displayname: "Frosty", profile_picture: "https://cdn.intra.42.fr/f.jpg" };
        return { ok: true, status: 200, json: async () => body };
      }),
    );
  }

  it("reads the freeze from the cursus call a full load already makes", async () => {
    const calls: string[] = [];
    stubIntrapy(calls);
    const r = await fetchFriendsIntraResult(["frosty"], { visuals: false });
    expect(r.friends[0].freezeUntil).toBe(LATER);
    expect(calls.filter((u) => u.includes("intrapy"))).toHaveLength(2); // /users + /cursus
  });

  it("carries the freeze over on an online-only load, which skips /cursus", async () => {
    const calls: string[] = [];
    stubIntrapy(calls);
    const known = friend({ freezeUntil: LATER });
    const r = await fetchFriendsIntraResult(["frosty"], {
      detail: "online",
      visuals: false,
      known: [known],
    });
    expect(calls.some((u) => u.endsWith("/cursus"))).toBe(false);
    expect(r.friends[0].freezeUntil).toBe(LATER);
  });
});
