/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The shared validators: one Intra API date parser (intrapy timestamps are
 * UTC without a suffix) used by every profile card, and one hex-colour check
 * (css-sanitize.ts) instead of a regex per feature.
 */
// Paris is UTC+2 in summer: a bare "23:30:00" lands on the next local day
// when read as UTC, and stays on the same day when read as local time.
process.env.TZ = "Europe/Paris";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseIntraDate } from "../src/core/intra/intrapy";
import { sanitizeColor } from "../src/features/shortcuts/shortcuts.ui";

vi.mock("../src/core/config.ts", () => ({
  getConfig: vi.fn(async (key: string) => key === "PROFILE_SHOW_ACHIEVEMENTS"),
}));
vi.mock("../src/features/account/account.ts", () => ({
  getCloudLogin: vi.fn(async () => "me"),
}));

const b64url = (s: string) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (expSeconds: number) =>
  `Bearer ${b64url(JSON.stringify({ alg: "RS256" }))}.${b64url(
    JSON.stringify({ exp: expSeconds }),
  )}.c2ln`;

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

const mount = (markup: string) =>
  document.body.replaceChildren(
    ...new DOMParser().parseFromString(markup, "text/html").body.childNodes,
  );

describe("parseIntraDate", () => {
  it("reads a bare intrapy timestamp as UTC", () => {
    expect(parseIntraDate("2026-08-20T23:30:00").toISOString()).toBe("2026-08-20T23:30:00.000Z");
  });

  it("leaves strings with an offset or Z alone", () => {
    expect(parseIntraDate("2026-08-20T23:30:00Z").toISOString()).toBe("2026-08-20T23:30:00.000Z");
    expect(parseIntraDate("2026-08-20T23:30:00+02:00").toISOString()).toBe(
      "2026-08-20T21:30:00.000Z",
    );
    expect(parseIntraDate("2026-08-20T23:30:00.000-0500").toISOString()).toBe(
      "2026-08-21T04:30:00.000Z",
    );
  });

  it("leaves date-only strings alone (already UTC)", () => {
    expect(parseIntraDate("2026-08-20").toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });
});

describe("achievements card dates", () => {
  beforeEach(() => {
    history.replaceState({}, "", "/");
    mount(`
      <div class="bg-white md:h-96">
        <span class="font-bold uppercase text-sm">Last achievements</span>
        <div class="h-full"><div class="grid"></div></div>
      </div>`);
    sessionStorage.setItem("ft_intrapy_token", jwt(Math.floor(Date.now() / 1000) + 3600));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a bare achieved_at on its UTC day converted to local time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/achievements")
          ? {
              ok: true,
              json: async () => [
                {
                  name: "Night owl",
                  achieved_at: "2026-08-20T23:30:00",
                  description: "desc",
                  svg: "https://cdn.example.com/a.svg",
                },
              ],
            }
          : { ok: true, text: async () => "<svg></svg>" },
      ),
    );
    vi.resetModules();
    const { initAchievements } = await import("../src/features/profile/cards/achievements.ts");
    await initAchievements();
    await settle();
    expect(document.getElementById("ft-achievements-injected")?.textContent).toContain(
      "Aug 21, 2026",
    );
  });
});

describe("freeze card dates", () => {
  beforeEach(async () => {
    history.replaceState({}, "", "/users/bob");
    mount(`
      <div class="flex flex-col lg:flex-row gap-6 md:gap-8">
        <div id="profile-card"></div>
      </div>`);
    await chrome.storage.local.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
    sessionStorage.setItem("ft_intrapy_token", jwt(Math.floor(Date.now() / 1000) + 3600));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("counts down to a bare freeze_until as UTC and names its local day", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [{ freeze_until: "2026-09-22T23:30:00" }],
      })),
    );
    vi.resetModules();
    const { initFreezeCard } = await import("../src/features/profile/cards/freeze.ts");
    await initFreezeCard();
    await settle();

    const card = document.getElementById("ft-freeze-card");
    expect(card).not.toBeNull();
    // 23:30 UTC is 01:30 Paris the next day
    expect(card!.textContent).toContain("Until September 23, 2026");
    const parts = [...card!.querySelector("span")!.shadowRoot!.querySelectorAll("span span")].map(
      (s) => s.textContent,
    );
    expect(parts).toEqual(["01", "13", "30", "00"]);
  });
});

describe("hex colours", () => {
  it("shortcuts fall back to the default colour for anything but #rrggbb", () => {
    expect(sanitizeColor(" #AaBbCc ")).toBe("#AaBbCc");
    expect(sanitizeColor("#abc")).toBe("#7dd3fc");
    expect(sanitizeColor("red")).toBe("#7dd3fc");
    expect(sanitizeColor(undefined)).toBe("#7dd3fc");
  });

  it("no feature keeps its own #rrggbb regex", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(name)) files.push(full);
      }
    };
    walk(join(__dirname, "../src/features"));
    // hexToHslTriplet/relativeLuminance accept a missing "#" on purpose: only
    // the strict form that duplicates sanitizeHexColor is forbidden.
    const offenders = files.filter((f) => /\^#\[0-9a-f(?:A-F)?\]\{6\}\$/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
