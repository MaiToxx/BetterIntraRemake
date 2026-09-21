/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The achievements list and the freeze card: the Intra token they send, and
 * whether a failed intrapy request is retried.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/core/config.ts", () => ({
  getConfig: vi.fn(async (key: string) => key === "PROFILE_SHOW_ACHIEVEMENTS"),
}));
vi.mock("../src/features/account/account.ts", () => ({
  getCloudLogin: vi.fn(async () => "me"),
}));

const b64url = (s: string) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (expSeconds: number, tag: string) =>
  `Bearer ${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(
    JSON.stringify({ exp: expSeconds, tag }),
  )}.c2ln`;
const nowS = () => Math.floor(Date.now() / 1000);

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replace the page body with this fixture (parsed, never assigned as HTML). */
const mount = (markup: string) =>
  document.body.replaceChildren(
    ...new DOMParser().parseFromString(markup, "text/html").body.childNodes,
  );

const sentTokens = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(
    (c) => ((c[1] as RequestInit | undefined)?.headers as Record<string, string>)?.Authorization,
  );

const dispatchToken = (token: string) =>
  document.dispatchEvent(new CustomEvent("42_INTRAPY_TOKEN", { detail: token }));

describe("achievements", () => {
  const achievementsCard = () => `
    <div class="bg-white md:h-96">
      <span class="font-bold uppercase text-sm">Last achievements</span>
      <div class="h-full"><div class="grid"></div></div>
    </div>`;
  const oneAchievement = [
    {
      name: "Bonus hunter",
      achieved_at: "2026-08-20T10:00:00Z",
      description: "desc",
      svg: "https://cdn.example.com/a.svg",
    },
  ];

  beforeEach(() => {
    history.replaceState({}, "", "/");
    mount(achievementsCard());
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function loadAchievements() {
    vi.resetModules();
    return (await import("../src/features/profile/cards/achievements.ts")).initAchievements;
  }

  it("waits for a fresh token instead of sending an expired one", async () => {
    const expired = jwt(nowS() - 60, "expired");
    const fresh = jwt(nowS() + 300, "fresh");
    sessionStorage.setItem("ft_intrapy_token", expired);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [],
      text: async () => "<svg></svg>",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const initAchievements = await loadAchievements();
    const done = initAchievements();
    await settle();
    expect(fetchMock, "nothing is sent with the expired token").not.toHaveBeenCalled();

    dispatchToken(expired);
    dispatchToken(fresh);
    await done;
    expect(sentTokens(fetchMock)).toEqual([fresh]);
  });

  it("retries a failed request on a later pass instead of giving up for the page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
    sessionStorage.setItem("ft_intrapy_token", jwt(nowS() + 3600, "fresh"));

    let fail = true;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/achievements")) {
        return fail
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => oneAchievement };
      }
      return { ok: true, text: async () => "<svg></svg>" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const achievementCalls = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/achievements")).length;

    const initAchievements = await loadAchievements();
    await initAchievements();
    expect(achievementCalls()).toBe(1);

    // the very next pass (profile.ts runs one per burst of Intra mutations)
    // does not hammer the API
    await initAchievements();
    expect(achievementCalls()).toBe(1);

    // a little later, the Intra answers again and the list is shown
    fail = false;
    vi.setSystemTime(new Date("2026-09-21T10:01:00Z"));
    await initAchievements();
    expect(achievementCalls()).toBe(2);
    await settle(80);
    expect(document.getElementById("ft-achievements-injected")?.textContent).toContain(
      "Bonus hunter",
    );

    // once it succeeded, it is not fetched again
    vi.setSystemTime(new Date("2026-09-21T10:05:00Z"));
    await initAchievements();
    expect(achievementCalls()).toBe(2);
  });
});

describe("freeze card", () => {
  beforeEach(async () => {
    history.replaceState({}, "", "/users/bob");
    mount(`
      <div class="flex flex-col lg:flex-row gap-6 md:gap-8">
        <div id="profile-card"></div>
      </div>`);
    sessionStorage.clear();
    await chrome.storage.local.clear();
  });

  it("waits for a fresh token instead of sending an expired one", async () => {
    const expired = jwt(nowS() - 60, "expired");
    const fresh = jwt(nowS() + 300, "fresh");
    sessionStorage.setItem("ft_intrapy_token", expired);
    const until = new Date(Date.now() + 7 * 86400000).toISOString();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ freeze_until: until }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { initFreezeCard } = await import("../src/features/profile/cards/freeze.ts");
    const done = initFreezeCard();
    await settle();
    expect(fetchMock, "nothing is sent with the expired token").not.toHaveBeenCalled();

    dispatchToken(expired);
    dispatchToken(fresh);
    await done;
    expect(sentTokens(fetchMock)).toEqual([fresh]);
    expect(document.getElementById("ft-freeze-card")?.dataset.freezeUntil).toBe(until);
  });
});
