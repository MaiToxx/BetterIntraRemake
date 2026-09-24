/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://projects.intra.42.fr/projects/libft" }
 *
 * The subject tracker's start-up on a projects page: it used to poll for the
 * subject PDF link 40 times over 6 s on every page without one (the last
 * setTimeout loop of the content script), seed a first visit with Date.now()
 * when the worker could not date the PDF (a red "Subject updated / just now"
 * on a subject nothing happened to), and let its state key grow forever.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initSubjectTracker } from "../src/features/subjects/tracker.ts";

const PDF = "https://cdn.intra.42.fr/pdf/pdf/900001/en.subject.pdf";
const BADGE_ID = "ft-subject-update-host";

const flush = async (times = 12) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

function mountAttachments(href = PDF): HTMLAnchorElement {
  const summary = document.createElement("div");
  summary.className = "project-summary";
  const list = document.createElement("div");
  list.className = "project-attachments-list";
  const a = document.createElement("a");
  a.href = href;
  list.appendChild(a);
  summary.appendChild(list);
  document.body.appendChild(summary);
  return a;
}

async function storedState() {
  const { SUBJECT_TRACKER_STATE } = await chrome.storage.local.get(
    "SUBJECT_TRACKER_STATE",
  );
  return SUBJECT_TRACKER_STATE as Record<
    string,
    { versionDate?: number; changedAt?: number; checkedAt?: number }
  >;
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.body.replaceChildren();
  (chrome.storage as { onChanged?: unknown }).onChanged ??= {
    addListener: () => {},
    removeListener: () => {},
  };
});

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waiting for the subject link", () => {
  it("costs one deadline timer on a page without a PDF, cancelled on pagehide", async () => {
    vi.useFakeTimers();
    const done = initSubjectTracker();
    await flush();
    // Before: a 150 ms setTimeout chain, 40 wake-ups over 6 s.
    expect(vi.getTimerCount()).toBe(1);
    window.dispatchEvent(new Event("pagehide"));
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    await expect(done).resolves.toBeUndefined();
  });

  it("still finds a link inserted later and renders the badge", async () => {
    vi.useFakeTimers();
    await chrome.storage.local.set({
      SUBJECT_TRACKER_STATE: {
        libft: { lastUrl: "https://cdn.intra.42.fr/pdf/pdf/1/en.subject.pdf" },
      },
    });
    const done = initSubjectTracker();
    await flush();
    vi.advanceTimersByTime(1000);
    mountAttachments();
    await flush(30);
    await done;
    expect(document.getElementById(BADGE_ID)).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a first visit the worker cannot date", () => {
  beforeEach(async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "tok", CLOUD_LOGIN: "bob" });
  });

  // Real Responses: the tracker goes through workerFetch, which reads headers.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const workerAnswering = (report: unknown | null) =>
    vi.fn(async (url: string) => {
      if (url.includes("/subjects/state")) {
        return json({ subjects: [{ slug: "libft", tracked: false }] });
      }
      return report ? json(report) : json({}, 503);
    });

  it("shows no badge when the report fails", async () => {
    vi.stubGlobal("fetch", workerAnswering(null));
    mountAttachments();
    await initSubjectTracker();
    // Before: seeded with Date.now(), i.e. a red "Subject updated / just now".
    expect(document.getElementById(BADGE_ID)).toBeNull();
    expect((await storedState()).libft.versionDate).toBeUndefined();
  });

  it("shows no badge when the PDF carries no dates", async () => {
    vi.stubGlobal(
      "fetch",
      workerAnswering({
        subjects: [{ slug: "libft", status: "first", createdAt: null, modifiedAt: null }],
      }),
    );
    mountAttachments();
    await initSubjectTracker();
    expect(document.getElementById(BADGE_ID)).toBeNull();
    expect((await storedState()).libft.versionDate).toBeUndefined();
  });
});

describe("the state key", () => {
  it("keeps the 500 most recently checked slugs", async () => {
    const state: Record<string, { checkedAt: number; lastUrl: string }> = {};
    for (let i = 0; i < 500; i++) {
      state[`slug-${i}`] = { checkedAt: 1000 + i, lastUrl: PDF };
    }
    await chrome.storage.local.set({ SUBJECT_TRACKER_STATE: state });
    mountAttachments();
    await initSubjectTracker();

    const stored = await storedState();
    expect(Object.keys(stored)).toHaveLength(500);
    expect(stored.libft).toBeDefined();
    // The oldest check is the one evicted.
    expect(stored["slug-0"]).toBeUndefined();
    expect(stored["slug-1"]).toBeDefined();
  });
});
