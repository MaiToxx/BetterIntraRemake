/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The freeze countdown on your own dashboard, not only on /users/<you>, with
 * the page's login when you are not signed in to cloud sync. The dashboard
 * runs a profile pass per Intra mutation burst for 30 s: the /cursus request
 * is sent once per page, not once per pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const FUTURE = new Date(Date.now() + 20 * 86400000).toISOString();

async function loadFreeze() {
  vi.resetModules();
  return (await import("../src/features/profile/cards/freeze.ts")).initFreezeCard;
}

function mountDashboard() {
  const row = document.createElement("div");
  row.className = "flex flex-col lg:flex-row gap-6 md:gap-8";
  row.appendChild(document.createElement("div")).id = "profile-card";
  const login = document.createElement("span");
  login.setAttribute("data-login", "");
  login.textContent = "carol";
  document.body.replaceChildren(row, login);
}

beforeEach(async () => {
  mountDashboard();
  await chrome.storage.local.clear();
  sessionStorage.setItem("ft_intrapy_token", "token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("freeze card on the dashboard", () => {
  it("shows your own freeze, for the page's login when signed out", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ freeze_until: FUTURE }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const initFreezeCard = await loadFreeze();

    await initFreezeCard();

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://intrapy.intra.42.fr/api/v1/users/carol/cursus",
    );
    expect(document.getElementById("ft-freeze-card")?.dataset.freezeUntil).toBe(FUTURE);
  });

  it("asks once per page when you are not frozen, however many passes run", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ freeze_until: null }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const initFreezeCard = await loadFreeze();

    for (let i = 0; i < 5; i++) await initFreezeCard();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ft-freeze-card")).toBeNull();
  });
});
