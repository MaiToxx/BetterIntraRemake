/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://projects.intra.42.fr/projects/list" }
 *
 * initLogtime() runs on every Intra page (main.ts does not gate features by
 * host). It used to switch the document's scroll restoration to "manual"
 * before checking the page, so Back and reload landed at the top of every
 * long projects list, cluster page and forum thread. Only the profile page
 * mounts the widget: every other page's scroll restoration is left alone.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { initLogtime } from "../src/features/logtime/logtime";

beforeAll(() => {
  // jsdom has no scrollRestoration: give history the browser's default
  Object.defineProperty(history, "scrollRestoration", {
    value: "auto",
    writable: true,
    configurable: true,
  });
});

describe("initLogtime on a non-profile page", () => {
  it("leaves the browser's scroll restoration alone", async () => {
    await initLogtime();
    expect(history.scrollRestoration).toBe("auto");
  });
});
