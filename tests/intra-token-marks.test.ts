/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The completed-projects list on your own profile: the Intra token it sends
 * and what happens when the intrapy request fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config.ts", () => ({
  getConfig: vi.fn(async (key: string) =>
    key === "PROFILE_SHOW_MARKS" ? true : "",
  ),
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

const projectsCard = () => `
  <div class="bg-white md:h-96">
    <div class="flex flex-col w-full h-full">
      <span class="font-bold uppercase text-sm">Projects</span>
      <div class="h-full"><ul><li>libft</li></ul></div>
    </div>
  </div>`;

const libft = [
  {
    projects_user_id: 1,
    project_name: "libft",
    project_slug: "libft",
    final_mark: 125,
    last_event_date: "2026-08-20T10:00:00",
    is_validated: true,
    occurrence: 0,
    teams: [],
  },
];

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replace the page body with this fixture (parsed, never assigned as HTML). */
const mount = (markup: string) =>
  document.body.replaceChildren(
    ...new DOMParser().parseFromString(markup, "text/html").body.childNodes,
  );

async function loadMarks() {
  vi.resetModules();
  return (await import("../src/features/profile/cards/marks.ts")).initMarks;
}

/** The Authorization header of every intrapy request made so far. */
const sentTokens = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(
    (c) => ((c[1] as RequestInit | undefined)?.headers as Record<string, string>)?.Authorization,
  );

describe("marks: Intra token and failed requests", () => {
  beforeEach(() => {
    mount(projectsCard());
    sessionStorage.clear();
    sessionStorage.setItem("ft_active_cursus_id", "21");
  });

  // Registers the 42_CURSUS_ID listener of its module instance: kept first so
  // no other test in this file dispatches that event afterwards.
  it("does not cache a failed request, and a cursus switch retries with the token of that moment", async () => {
    const first = jwt(nowS() + 300, "first");
    const later = jwt(nowS() + 600, "later");
    sessionStorage.setItem("ft_intrapy_token", first);

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      // the page-load token has been revoked by the time of the retry
      if (auth === first) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => libft };
    });
    vi.stubGlobal("fetch", fetchMock);

    const initMarks = await loadMarks();
    await initMarks();
    await settle();
    expect(document.getElementById("ft-marks-injected")).toBeNull();
    expect(document.getElementById("ft-marks-skeleton")).toBeNull();

    // The page refreshed its session, then the student switches back to the
    // same cursus: the 401 above must not have been kept as "no projects".
    sessionStorage.setItem("ft_intrapy_token", later);
    document.dispatchEvent(new CustomEvent("42_CURSUS_ID", { detail: "21" }));
    await settle(80);

    expect(sentTokens(fetchMock)).toEqual([first, later]);
    const injected = document.getElementById("ft-marks-injected");
    expect(injected, "the retry filled the list").not.toBeNull();
    expect(injected!.textContent).toContain("libft");
  });

  it("waits for a fresh token instead of sending an expired one", async () => {
    const expired = jwt(nowS() - 60, "expired");
    const fresh = jwt(nowS() + 300, "fresh");
    sessionStorage.setItem("ft_intrapy_token", expired);

    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => libft }));
    vi.stubGlobal("fetch", fetchMock);

    const initMarks = await loadMarks();
    const done = initMarks();
    await settle();
    expect(fetchMock, "nothing is sent with the expired token").not.toHaveBeenCalled();

    // hook.js re-dispatches the stale token on load, then the page's own
    // request brings the fresh one
    document.dispatchEvent(new CustomEvent("42_INTRAPY_TOKEN", { detail: expired }));
    document.dispatchEvent(new CustomEvent("42_INTRAPY_TOKEN", { detail: fresh }));
    await done;
    await settle();

    expect(sentTokens(fetchMock)).toEqual([fresh]);
    expect(document.getElementById("ft-marks-injected")).not.toBeNull();
  });
});
