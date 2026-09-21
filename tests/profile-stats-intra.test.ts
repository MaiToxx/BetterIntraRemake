import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PROFILE_STATS_CACHE_KEY,
  PROFILE_STATS_CACHE_MAX,
  PROFILE_STATS_TTL_MS,
  computeEvalStats,
  monthKeyFromText,
  nextFeedbackPage,
  parseCorrectorFeedbacks,
  parseRouletteHistorics,
  pruneProfileStatsCache,
  readProfileStatsCache,
  resetProfileStatsCacheState,
  writeProfileStatsCache,
  type ProfileStatsCache,
} from "../src/features/profile/cards/profile-stats-intra";

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

  it("parses the French day-first order", () => {
    expect(monthKeyFromText("13 septembre 2026 14:30")).toBe("2026-09");
    expect(monthKeyFromText("1 décembre 2025 08:00")).toBe("2025-12");
    expect(monthKeyFromText("31 août 2026")).toBe("2026-08");
    expect(monthKeyFromText("planifiée le 5 mars 2026 à 10:00")).toBe("2026-03");
    expect(monthKeyFromText("13 nonsense 2026")).toBeNull();
  });
});

describe("parseCorrectorFeedbacks with French dates", () => {
  it("counts evaluations whose header uses the French order", () => {
    const html = feedbacksPage(
      feedbackItem("13 septembre 2026 14:30", "80 %", true) +
        feedbackItem("30 août 2026 09:00", "40 %", false),
    );
    const stats = computeEvalStats(parseCorrectorFeedbacks(html));
    expect(stats.byMonth["2026-09"]).toEqual({ total: 1, failed: 0, successPercentage: 100 });
    expect(stats.byMonth["2026-08"]).toEqual({ total: 1, failed: 1, successPercentage: 0 });
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

describe("profile stats cache", () => {
  const now = 1_800_000_000_000;
  const data = (n: number) => ({
    roulette: [],
    evalStats: { byMonth: {}, global: { total: n, failed: 0, successPercentage: 100 } },
  });

  beforeEach(async () => {
    await chrome.storage.local.clear();
    resetProfileStatsCacheState();
  });

  it("stores every login under a single key and reads it back within the TTL", async () => {
    await writeProfileStatsCache("alice", data(1), now);
    await writeProfileStatsCache("bob", data(2), now + 1000);
    const store = await chrome.storage.local.get(null);
    expect(Object.keys(store)).toEqual([PROFILE_STATS_CACHE_KEY]);
    expect(await readProfileStatsCache("alice", now + 5000)).toEqual(data(1));
    expect(await readProfileStatsCache("bob", now + 5000)).toEqual(data(2));
    expect(await readProfileStatsCache("carol", now + 5000)).toBeNull();
  });

  it("expires entries after one hour", async () => {
    await writeProfileStatsCache("alice", data(1), now);
    expect(await readProfileStatsCache("alice", now + PROFILE_STATS_TTL_MS - 1)).toEqual(data(1));
    expect(await readProfileStatsCache("alice", now + PROFILE_STATS_TTL_MS)).toBeNull();
  });

  it("prunes expired entries and caps the map on write", async () => {
    await writeProfileStatsCache("stale", data(0), now - PROFILE_STATS_TTL_MS - 1);
    for (let i = 0; i < PROFILE_STATS_CACHE_MAX + 5; i++) {
      await writeProfileStatsCache(`user${i}`, data(i), now + i);
    }
    const store = await chrome.storage.local.get(PROFILE_STATS_CACHE_KEY);
    const cache = store[PROFILE_STATS_CACHE_KEY] as ProfileStatsCache;
    const logins = Object.keys(cache);
    expect(logins).toHaveLength(PROFILE_STATS_CACHE_MAX);
    expect(logins).not.toContain("stale");
    // the oldest fresh entries are the ones dropped
    expect(logins).not.toContain("user0");
    expect(logins).toContain(`user${PROFILE_STATS_CACHE_MAX + 4}`);
  });

  it("pruneProfileStatsCache keeps the most recent entries", () => {
    const cache: ProfileStatsCache = {
      old: { at: now - PROFILE_STATS_TTL_MS, data: data(0) },
      a: { at: now - 10, data: data(1) },
      b: { at: now - 5, data: data(2) },
    };
    expect(Object.keys(pruneProfileStatsCache(cache, now))).toEqual(["b", "a"]);
  });

  it("removes the legacy per-login keys once, keeping the new key", async () => {
    await chrome.storage.local.set({
      FT_PROFILE_STATS_alice: { at: now, data: data(1) },
      FT_PROFILE_STATS_bob: { at: now, data: data(2) },
      OTHER_KEY: "keep",
    });
    await writeProfileStatsCache("carol", data(3), now);
    const store = await chrome.storage.local.get(null);
    expect(Object.keys(store).sort()).toEqual([PROFILE_STATS_CACHE_KEY, "OTHER_KEY"].sort());
    expect(store.OTHER_KEY).toBe("keep");

    // only the first write scans the whole storage
    const getCalls = vi.mocked(chrome.storage.local.get).mock.calls.filter((c) => c[0] === null).length;
    await writeProfileStatsCache("dave", data(4), now);
    const getCallsAfter = vi.mocked(chrome.storage.local.get).mock.calls.filter((c) => c[0] === null).length;
    expect(getCallsAfter).toBe(getCalls);
  });
});
