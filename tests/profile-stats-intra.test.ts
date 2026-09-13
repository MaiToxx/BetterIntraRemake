import { describe, it, expect } from "vitest";
import {
  computeEvalStats,
  monthKeyFromText,
  nextFeedbackPage,
  parseCorrectorFeedbacks,
  parseRouletteHistorics,
} from "../src/features/profile/profile-stats-intra";

const feedbackItem = (date: string, mark: string, positive: boolean) => `
<li class="table-item scaleteam-list-item">
  <div class="header">
    <b><a href="#">alepayen</a></b> evaluated <b><a href="#">ale-tadi's group-1</a></b> scheduled on <b>${date}</b>
    <div class="pull-right"><b>C Piscine C 05</b> <code class="rating" ${positive ? 'data-positive=""' : ""}>${positive ? "ok" : "ko"}</code></div>
  </div>
  <div class="final-mark"><div class="rating" ${positive ? 'data-positive=""' : ""}> ${mark} </div><div class="comment">…</div></div>
</li>`;

const feedbacksPage = (items: string, pages = "") =>
  `<html><body><ul>${items}</ul><div class="pagination">${pages}</div></body></html>`;

describe("monthKeyFromText", () => {
  it("parses English and French month names", () => {
    expect(monthKeyFromText("September 13, 2026 14:30")).toBe("2026-09");
    expect(monthKeyFromText("Septembre 13, 2026 19:15")).toBe("2026-09");
    expect(monthKeyFromText("Décembre 1, 2025 08:00")).toBe("2025-12");
    expect(monthKeyFromText("no date here")).toBeNull();
  });
});

describe("parseCorrectorFeedbacks + computeEvalStats", () => {
  it("counts evaluations per month and failures below 50 %", () => {
    const html = feedbacksPage(
      feedbackItem("September 13, 2026 14:30", "80 %", true) +
        feedbackItem("September 12, 2026 11:00", "35 %", false) +
        feedbackItem("August 30, 2026 09:00", "100 %", true),
    );
    const fb = parseCorrectorFeedbacks(html);
    expect(fb).toHaveLength(3);
    const stats = computeEvalStats(fb);
    expect(stats.byMonth["2026-09"]).toEqual({ total: 2, failed: 1, successPercentage: 50 });
    expect(stats.byMonth["2026-08"]).toEqual({ total: 1, failed: 0, successPercentage: 100 });
    expect(stats.global).toEqual({ total: 3, failed: 1, successPercentage: 66.7 });
  });

  it("gives null percentages with no data", () => {
    expect(computeEvalStats([]).global.successPercentage).toBeNull();
  });
});

describe("nextFeedbackPage", () => {
  it("follows pagination links until the last page", () => {
    const html = feedbacksPage(
      "",
      '<a href="/users/alepayen/feedbacks?as=corrector&amp;page=2">2</a><a href="/users/alepayen/feedbacks?as=corrector&page=3">3</a>',
    );
    expect(nextFeedbackPage(html, 1)).toBe(2);
    expect(nextFeedbackPage(html, 2)).toBe(3);
    expect(nextFeedbackPage(html, 3)).toBeNull();
    expect(nextFeedbackPage(feedbacksPage(""), 1)).toBeNull();
  });
});

describe("parseRouletteHistorics", () => {
  it("keeps only roulette entries with delta, total and date", () => {
    const html = `<div class="changelogs-list">
      <div class="changelog-item"><div class="changelog-main">
        <p class="title"><code data-count="7" data-date="2026-09-13 16:08:57 UTC">-1</code> <span class="reason"> Defense plannification </span></p>
        <p class="title"><code data-count="12" data-date="2026-09-11 06:00:00 UTC">+3</code> <span class="reason"> Thursday Roulette </span></p>
        <p class="title"><code data-count="9" data-date="2026-09-04 06:00:00 UTC">+2</code> <span class="reason"> Roulette du jeudi </span></p>
      </div></div></div>`;
    const entries = parseRouletteHistorics(html);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ sum: 3, total: 12, created_at: "2026-09-11T06:00:00Z" });
    expect(entries[1]).toMatchObject({ sum: 2, total: 9 });
    expect(entries[0].historic_id).not.toBe(entries[1].historic_id);
  });
});
