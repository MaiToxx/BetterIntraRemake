/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * A failed marks request on your own dashboard (a token that expired in
 * flight, a 429, a network error) is not "no finished projects": it is asked
 * again 10 s later, by a timer of its own, since the profile watcher runs
 * passes only on Intra mutations and stops 30 s after load. The list used to
 * stay missing for the whole visit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/core/config.ts", () => ({
  getConfig: vi.fn(async (key: string) => (key === "PROFILE_SHOW_MARKS" ? true : "")),
}));
vi.mock("../src/features/account/account.ts", () => ({
  getCloudLogin: vi.fn(async () => "me"),
}));

const b64url = (s: string) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = `Bearer ${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(
  JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
)}.c2ln`;

const project = (name: string) => ({
  projects_user_id: 1,
  project_name: name,
  project_slug: name,
  final_mark: 100,
  last_event_date: "2026-08-20T10:00:00",
  is_validated: true,
  occurrence: 0,
  teams: [],
});

function mountProjectsCard() {
  const card = document.createElement("div");
  card.className = "bg-white md:h-96";
  const inner = document.createElement("div");
  inner.className = "flex flex-col w-full h-full";
  const title = document.createElement("span");
  title.className = "font-bold uppercase text-sm";
  title.textContent = "Projects";
  const list = document.createElement("div");
  list.className = "h-full";
  // the Intra's own in-progress rows: the card counts as rendered
  const rows = document.createElement("ul");
  rows.appendChild(document.createElement("li")).textContent = "minishell";
  list.appendChild(rows);
  inner.append(title, list);
  card.appendChild(inner);
  document.body.replaceChildren(card);
}

/** Lets the fake clock run: the frames the card lookup waits for, the fetch. */
const settle = (ms = 100) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  mountProjectsCard();
  sessionStorage.clear();
  sessionStorage.setItem("ft_active_cursus_id", "21");
  sessionStorage.setItem("ft_intrapy_token", token);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("marks on your own dashboard", () => {
  // Every module instance keeps its 42_CURSUS_ID listener on the document:
  // the case that dispatches the event runs first, so no older one answers.
  it("asks again by itself 10 s after a failure, with no pass, and keeps one cursus listener", async () => {
    let fail = true;
    const fetchMock = vi.fn(async (url: string) => {
      if (fail) return { ok: false, status: 429, json: async () => ({}) };
      const cursus = new URL(url).searchParams.get("cursus_id");
      return { ok: true, status: 200, json: async () => [project(`libft-${cursus}`)] };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { initMarks } = await import("../src/features/profile/cards/marks.ts");

    const first = initMarks();
    await settle();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ft-marks-injected")).toBeNull();
    expect(document.getElementById("ft-marks-skeleton")).toBeNull();

    // A pass in the meantime leaves the card alone...
    fail = false;
    await initMarks();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ft-marks-skeleton")).toBeNull();

    // ...and the retry comes on its own: no initMarks() call from a pass.
    await settle(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.getElementById("ft-marks-injected")?.textContent).toContain("libft-21");

    // Loaded: later passes, and the timers, cost nothing.
    await initMarks();
    await settle(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Both page-load attempts went through the listener registration: one
    // cursus switch is still one request.
    document.dispatchEvent(new CustomEvent("42_CURSUS_ID", { detail: "9" }));
    await settle(200);
    expect(document.getElementById("ft-marks-injected")?.textContent).toContain("libft-9");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after three retries, and a pass does not ask again", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const { initMarks } = await import("../src/features/profile/cards/marks.ts");

    const first = initMarks();
    await settle();
    await first;
    await settle(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await initMarks();
    await settle(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(document.getElementById("ft-marks-skeleton")).toBeNull();
  });
});
