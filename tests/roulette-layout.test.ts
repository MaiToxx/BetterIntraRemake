/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The roulette counters (Wins, Points, Next) need about 510 px on one line,
 * more than the card has inside on a phone and at common desktop widths
 * (1024-1290 px with two columns, 1536-1890 px with three, measured in
 * Chrome): the Next countdown was cut at the card's edge. They wrap now.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../src/core/config.ts", () => ({
  getConfig: vi.fn(async (key: string) =>
    key === "PROFILE_SHOW_ROULETTE" || key === "PROFILE_SHOW_ROULETTE_HISTORY"
      ? true
      : "token",
  ),
}));
vi.mock("../src/features/account/account.ts", () => ({
  getCloudLogin: vi.fn(async () => "me"),
}));
vi.mock("../src/core/crypto.ts", () => ({
  hashLogin: vi.fn(async () => "hashed"),
}));

import { initRouletteStats } from "../src/features/profile/cards/roulette-stats.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("roulette counters", () => {
  it("wrap and stay centred instead of running past the card", async () => {
    const card = document.createElement("div");
    card.className = "bg-white md:h-96";
    const title = document.createElement("span");
    title.className = "font-bold uppercase text-sm";
    title.textContent = "Agenda";
    card.appendChild(title);
    const main = document.createElement("div");
    main.className = "dash-main";
    main.appendChild(card);
    document.body.replaceChildren(main);
    // the placeholders are enough: the row exists before the worker answers
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    await initRouletteStats();
    await vi.waitFor(() =>
      expect(document.getElementById("ft-roulette-countdown")).not.toBeNull(),
    );
    const row = document.getElementById("ft-roulette-countdown")!.parentElement!
      .parentElement!;
    expect(row.children).toHaveLength(3);
    expect(row.style.flexWrap).toBe("wrap");
    expect(row.style.justifyContent).toBe("center");
  });
});
