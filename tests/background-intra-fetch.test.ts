/**
 * @vitest-environment node
 *
 * The background's FT_FETCH_INTRA_PAGE handler gives up on a slow Intra
 * instead of leaving the content script's skeleton up until the browser's own
 * network timeout.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

type Listener = (msg: unknown, sender: unknown, respond: (r: unknown) => void) => unknown;

let onMessage: Listener;

beforeAll(async () => {
  const noopEvent = { addListener: vi.fn() };
  (globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    runtime: {
      getManifest: () => ({ version: "1.0.0" }),
      onInstalled: noopEvent,
      onStartup: noopEvent,
      onMessage: {
        addListener: vi.fn((fn: Listener) => {
          onMessage = fn;
        }),
      },
    },
    alarms: { create: vi.fn(), onAlarm: noopEvent },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    tabs: { query: vi.fn(async () => []), reload: vi.fn() },
    storage: { ...(globalThis as any).chrome.storage, onChanged: noopEvent },
  };
  await import("../src/background.ts");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Ask the handler for a page; resolves with its answer, or "pending" after `ms`. */
function ask(url: string, ms = 300): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("pending"), ms);
    onMessage({ type: "FT_FETCH_INTRA_PAGE", url }, {}, (answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

describe("background: FT_FETCH_INTRA_PAGE", () => {
  it("aborts a request that takes too long and answers ok: false", async () => {
    const requested: number[] = [];
    // AbortSignal.timeout is driven by an internal timer, not the global
    // setTimeout, so the deadline is shortened here rather than waited for.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      requested.push(ms);
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), 10);
      return controller.signal;
    });
    // an Intra that never answers: only an abort ends the request
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      ),
    );

    const answer = await ask("https://profile.intra.42.fr/users/bob/correction_point_historics");
    expect(answer).toEqual({ ok: false });
    expect(requested).toEqual([15000]);
  });

  it("still returns the page when the Intra answers in time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://profile.intra.42.fr/users/bob",
        text: async () => "<html>page</html>",
      })),
    );
    const answer = await ask("https://profile.intra.42.fr/users/bob");
    expect(answer).toEqual({ ok: true, status: 200, text: "<html>page</html>" });
  });

  it("refuses URLs outside the Intra", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await ask("https://evil.example.com/")).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
