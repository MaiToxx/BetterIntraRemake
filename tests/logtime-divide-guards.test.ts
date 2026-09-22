/**
 * The month card, the compact group and the header divide by the goal and
 * the emoji value. A goal of 0 or "" (stored by the hub before it clamped)
 * printed "Infinity%" with the rainbow badge on a month with hours, "NaN%"
 * on an empty one, and an emoji value of 0 printed "Infinity 🌮" everywhere.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "lit-html";
import {
  renderMonthCard,
  renderHeaderContent,
} from "../src/features/logtime/render";
import { renderCompactMonthGroup } from "../src/features/logtime/compact";
import type { LogtimeConfig } from "../src/features/logtime/types";

function makeConfig(over: Partial<LogtimeConfig>): LogtimeConfig {
  return {
    show_tacos: true,
    show_goal: true,
    show_average: true,
    emoji: "🌮",
    divisor: 8.7,
    rate: 2,
    max_earnings: 500,
    goal_hours: 140,
    show_days_mode: "date",
    calendar_color: "#00bcba",
    labels_color: "#000000",
    rainbow_colors: ["#f00", "#0f0"],
    disable_animations: false,
    calendar_view: "normal",
    ...over,
  } as unknown as LogtimeConfig;
}

const WITH_HOURS = { "2026-08-03": 5 * 3600, "2026-08-04": 2 * 3600 };
const EMPTY: Record<string, number> = {};

function textOf(tpl: unknown): { text: string; root: HTMLElement } {
  const root = document.createElement("div");
  render(tpl as Parameters<typeof render>[0], root);
  return { text: root.textContent || "", root };
}

const BROKEN: [string, Partial<LogtimeConfig>][] = [
  ["goal 0", { goal_hours: 0 }],
  ["goal \"\"", { goal_hours: "" as unknown as number }],
  ["divisor 0", { divisor: 0 }],
  ["divisor \"\"", { divisor: "" as unknown as number }],
];

describe("renderMonthCard", () => {
  for (const [name, over] of BROKEN) {
    it(`prints neither Infinity nor NaN with ${name}`, () => {
      for (const data of [WITH_HOURS, EMPTY]) {
        const { text, root } = textOf(
          renderMonthCard("2026-08", data, false, makeConfig(over)),
        );
        expect(text).not.toMatch(/Infinity|NaN/);
        expect(root.querySelector(".badge-rainbow")).toBeNull();
        const bar = root.querySelector<HTMLElement>(".liquid-fill, .liquid-fill-full");
        expect(bar?.getAttribute("style") ?? "").not.toMatch(/NaN|Infinity/);
      }
    });
  }
});

describe("renderCompactMonthGroup", () => {
  for (const [name, over] of BROKEN) {
    it(`prints neither Infinity nor NaN with ${name}`, () => {
      for (const data of [WITH_HOURS, EMPTY]) {
        const { text } = textOf(
          renderCompactMonthGroup([{ ym: "2026-08", data }], makeConfig(over)),
        );
        expect(text).not.toMatch(/Infinity|NaN/);
      }
    });
  }
});

describe("renderHeaderContent", () => {
  it("prints a finite emoji total with divisor 0", () => {
    const { text } = textOf(
      renderHeaderContent(
        "7h",
        { "2026-08": WITH_HOURS },
        makeConfig({ divisor: 0 }),
        "normal",
        vi.fn(),
        "#00bcba",
        "#ffffff",
      ),
    );
    expect(text).not.toMatch(/Infinity|NaN/);
  });
});
