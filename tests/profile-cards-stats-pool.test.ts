/**
 * fetchProfileStatsViaIntra used to read the feedback pages one after the
 * other, then the correction-point history: up to 16 serial v2 round trips
 * per profile. It now reads the history with page 1 and the later pages
 * through a small pool, stops at the first empty page, and never caches a
 * total the page cap would have truncated.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FEEDBACK_PAGE_CONCURRENCY,
  MAX_FEEDBACK_PAGES,
  fetchProfileStatsViaIntra,
  lastFeedbackPage,
} from "../src/features/profile/cards/profile-stats-intra";

const feedbackItem = (date: string, mark: number) => `
<li class="table-item scaleteam-list-item">
  <div class="header">evaluated someone scheduled on <b>${date}</b></div>
  <div class="final-mark"><div class="rating" ${mark >= 50 ? "data-positive" : ""}>${mark} %</div></div>
</li>`;
const links = (pages: number[]) =>
  pages
    .map((p) => `<a href="/users/bob/feedbacks?as=corrector&amp;page=${p}">${p}</a>`)
    .join("");
const historics = `<div class="changelog-item"><p class="title">
  <code data-count="12" data-date="2026-09-11 06:00:00 UTC">+3</code>
  <span class="reason">Thursday Roulette</span></p></div>`;

type Answer = { ok: boolean; text?: string };

/**
 * A background whose answers are released by hand, so the order and the
 * number of requests in flight can be observed.
 */
function serveManually(pageHtml: (page: number) => string | null) {
  const pending: { url: string; resolve: (a: Answer) => void }[] = [];
  const requested: string[] = [];
  const sendMessage = vi.fn(
    ({ url }: { url: string }) =>
      new Promise<Answer>((resolve) => {
        requested.push(url);
        pending.push({ url, resolve });
      }),
  );
  (globalThis as any).chrome.runtime = { sendMessage };
  const release = (match: string) => {
    const i = pending.findIndex((p) => p.url.includes(match));
    if (i < 0) throw new Error(`no pending request for ${match}`);
    const [{ url, resolve }] = pending.splice(i, 1);
    if (url.includes("correction_point_historics")) {
      resolve({ ok: true, text: historics });
      return;
    }
    const page = Number(/page=(\d+)/.exec(url)![1]);
    const html = pageHtml(page);
    resolve(html === null ? { ok: false } : { ok: true, text: html });
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { pending, requested, release, settle };
}

/** `count` evaluations on a page, with links to `lastLink`. */
const fullPage = (page: number, lastLink: number, count = 2) =>
  `<ul>${Array.from({ length: count }, (_, i) =>
    feedbackItem(`September ${page}, 2026 1${i}:00`, page % 2 ? 80 : 30),
  ).join("")}</ul>${links([lastLink])}`;

describe("lastFeedbackPage", () => {
  it("returns the highest page the links advertise, 1 without any", () => {
    expect(lastFeedbackPage(links([2, 3, 7]))).toBe(7);
    expect(lastFeedbackPage(`<a href="/feedbacks?as=corrector&page=4">4</a>`)).toBe(4);
    expect(lastFeedbackPage("<ul></ul>")).toBe(1);
  });
});

describe("fetchProfileStatsViaIntra: request pattern", () => {
  afterEach(() => {
    delete (globalThis as any).chrome.runtime;
  });

  it("asks for the history together with page 1, then the other pages in a pool of 3", async () => {
    const s = serveManually((p) => fullPage(p, 6));
    const done = fetchProfileStatsViaIntra("bob");
    await s.settle();
    // both first requests in flight before anything answered
    expect(s.requested.filter((u) => u.includes("correction_point_historics"))).toHaveLength(1);
    expect(s.requested.filter((u) => u.includes("page=1"))).toHaveLength(1);
    expect(s.pending).toHaveLength(2);

    s.release("page=1");
    await s.settle();
    // page 1 links to 6 pages: three of the remaining five start at once
    const inFlight = () => s.pending.filter((p) => p.url.includes("feedbacks")).map((p) => p.url);
    expect(inFlight()).toHaveLength(FEEDBACK_PAGE_CONCURRENCY);
    expect(inFlight().map((u) => /page=(\d+)/.exec(u)![1])).toEqual(["2", "3", "4"]);

    // out of order: the pool keeps 3 in flight and the result stays in page order
    s.release("page=3");
    await s.settle();
    expect(inFlight()).toHaveLength(3);
    s.release("page=2");
    s.release("page=4");
    await s.settle();
    s.release("page=5");
    s.release("page=6");
    await s.settle();
    expect(inFlight()).toHaveLength(0);
    s.release("correction_point_historics");

    const r = await done;
    expect(r.complete).toBe(true);
    expect(r.rouletteLoaded).toBe(true);
    // 6 pages of 2 evaluations, each page fetched exactly once
    expect(r.evalStats?.global.total).toBe(12);
    const pages = s.requested.filter((u) => u.includes("feedbacks")).map((u) => /page=(\d+)/.exec(u)![1]);
    expect([...pages].sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("stops at the first empty page and does not request the pages after it", async () => {
    // the links promise 8 pages but the list ends after page 3
    const s = serveManually((p) => (p <= 3 ? fullPage(p, 8) : `<ul></ul>${links([8])}`));
    const done = fetchProfileStatsViaIntra("bob");
    await s.settle();
    s.release("page=1");
    await s.settle();
    for (const p of [2, 3, 4]) s.release(`page=${p}`);
    await s.settle();
    // page 4 was empty: only whatever was already started may still be pending
    const started = s.requested.filter((u) => u.includes("feedbacks")).map((u) => Number(/page=(\d+)/.exec(u)![1]));
    expect(Math.max(...started)).toBeLessThanOrEqual(6);
    for (const p of started.filter((n) => n > 4)) s.release(`page=${p}`);
    s.release("correction_point_historics");
    const r = await done;
    expect(r.complete).toBe(true);
    expect(r.evalStats?.global.total).toBe(6);
    expect(started).not.toContain(8);
  });

  it("follows windowed pagination: links seen on later pages extend the walk", async () => {
    // page 1 only links to 2 and 3; page 3 reveals page 4 and 5
    const s = serveManually((p) => {
      if (p === 1) return `<ul>${feedbackItem("September 1, 2026 10:00", 80)}</ul>${links([2, 3])}`;
      if (p === 3) return `<ul>${feedbackItem("September 3, 2026 10:00", 80)}</ul>${links([4, 5])}`;
      return `<ul>${feedbackItem(`September ${p}, 2026 10:00`, 80)}</ul>${links([p])}`;
    });
    const done = fetchProfileStatsViaIntra("bob");
    await s.settle();
    s.release("page=1");
    await s.settle();
    s.release("page=2");
    s.release("page=3");
    await s.settle();
    s.release("page=4");
    s.release("page=5");
    await s.settle();
    s.release("correction_point_historics");
    const r = await done;
    expect(r.complete).toBe(true);
    expect(r.evalStats?.global.total).toBe(5);
  });

  it("a failed later page gives no stats but keeps the history", async () => {
    const s = serveManually((p) => (p === 3 ? null : fullPage(p, 4)));
    const done = fetchProfileStatsViaIntra("bob");
    await s.settle();
    s.release("page=1");
    await s.settle();
    s.release("page=3");
    s.release("page=2");
    s.release("page=4");
    await s.settle();
    s.release("correction_point_historics");
    const r = await done;
    expect(r.complete).toBe(false);
    expect(r.evalStats).toBeNull();
    expect(r.rouletteLoaded).toBe(true);
    expect(r.roulette).toHaveLength(1);
  });

  it("reports an incomplete read when the page cap is hit with pages left", async () => {
    const s = serveManually((p) => fullPage(p, MAX_FEEDBACK_PAGES + 5, 1));
    const done = fetchProfileStatsViaIntra("bob");
    await s.settle();
    s.release("page=1");
    await s.settle();
    for (let p = 2; p <= MAX_FEEDBACK_PAGES; p++) {
      s.release(`page=${p}`);
      await s.settle();
    }
    s.release("correction_point_historics");
    const r = await done;
    const pages = s.requested.filter((u) => u.includes("feedbacks"));
    expect(pages).toHaveLength(MAX_FEEDBACK_PAGES);
    // the total would be too low and still look real: not shown, not cached
    expect(r.evalStats).toBeNull();
    expect(r.complete).toBe(false);
  });
});
