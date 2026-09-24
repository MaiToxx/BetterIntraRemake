/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The weekly pace bars get the /locations_stats payload even when the page
 * fetched it before the first profile pass ran initPace(): hook.js dispatches
 * it once, and replays it only for logtime.ts's own request, sent before any
 * profile pass. And a later payload also reaches the hour tooltips.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** The Intra's pace card: four bars, four week labels, the days ring. */
function mountPaceCard() {
  const row = document.createElement("div");
  row.className = "flex flex-row items-center";
  const ring = document.createElement("div");
  ring.className = "w-2/5";
  const barsCol = document.createElement("div");
  const bars = document.createElement("div");
  bars.className = "flex flex-wrap-reverse";
  for (let i = 0; i < 4; i++) {
    const bar = document.createElement("div");
    bar.className = "rounded-3xl";
    bars.appendChild(bar);
  }
  const labels = document.createElement("div");
  labels.className = "h-8 flex";
  for (let i = 0; i < 4; i++) {
    const label = document.createElement("div");
    label.textContent = "native";
    labels.appendChild(label);
  }
  barsCol.append(bars, labels);
  row.append(ring, barsCol);
  document.body.appendChild(row);
  return {
    bars: [...bars.children] as HTMLElement[],
    labels: [...labels.children] as HTMLElement[],
  };
}

/** YYYY-MM-DD of today, local time (the pace card counts local weeks). */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const logtime = (detail: Record<string, string>) =>
  document.dispatchEvent(new CustomEvent("42_LOGTIME_DATA", { detail }));

/** Hovers bar `bar` with the Intra's Radix tooltip open, and returns its text. */
async function hover(bar: HTMLElement): Promise<string> {
  document.querySelectorAll(".ft-test-tip").forEach((el) => el.remove());
  const outer = document.createElement("div");
  outer.className = "z-50 ft-test-tip";
  outer.append(document.createTextNode(" 0H "));
  const tip = document.createElement("span");
  tip.setAttribute("role", "tooltip");
  tip.textContent = "0H";
  outer.appendChild(tip);
  document.body.appendChild(outer);
  bar.dispatchEvent(new MouseEvent("mouseenter"));
  return tip.textContent ?? "";
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.resetModules();
});

describe("pace card", () => {
  it("draws a payload that arrived before initPace()", async () => {
    const { initPace } = await import("../src/features/profile/cards/pace.ts");
    const card = mountPaceCard();

    // The page's /locations_stats answer lands first...
    logtime({ [today()]: "03:30:00" });
    expect(card.labels[3].textContent).toBe("native");

    // ...then the profile pass that finds the card.
    initPace();

    expect(card.labels[3].textContent).toBe("This week");
    expect(card.labels[0].textContent).toMatch(/^W\d{2}$/);
    expect(card.bars[3].style.height).toBe(`${(3.5 / 60) * 100}%`);
    expect(await hover(card.bars[3])).toBe("3H 30M");
  });

  it("gives the tooltips the hours of the latest payload", async () => {
    const { initPace } = await import("../src/features/profile/cards/pace.ts");
    const card = mountPaceCard();
    initPace();
    logtime({ [today()]: "01:00:00" });
    expect(await hover(card.bars[3])).toBe("1H");

    // The page fetches the stats again: bars and tooltips follow.
    logtime({ [today()]: "05:15:00" });
    expect(card.bars[3].style.height).toBe(`${(5.25 / 60) * 100}%`);
    expect(await hover(card.bars[3])).toBe("5H 15M");
  });
});
