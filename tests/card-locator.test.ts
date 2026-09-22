/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * Every card module locates its Intra dashboard card through one rule in
 * src/core/intra/selectors.ts. The guard below keeps the utility-class string
 * from creeping back into the features, so the next Intra rename is a
 * one-line change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DASHBOARD_CARD_SELECTOR,
  findDashboardCard,
  waitForDashboardCard,
} from "../src/core/intra/selectors.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

const PENDING: string[] = [];

describe("dashboard card selector guard", () => {
  it("keeps the card class string out of the feature modules", () => {
    const features = join(__dirname, "../src/features");
    const offenders = sourceFiles(features)
      .filter((file) => /\.bg-white\.md\\\\?:h-96/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(features.length + 1))
      .filter((file) => !PENDING.includes(file));
    expect(offenders).toEqual([]);
  });
});

const card = (title: string, rows = 0): HTMLElement => {
  const el = document.createElement("div");
  el.className = "bg-white md:h-96";
  const heading = document.createElement("span");
  heading.className = "font-bold uppercase text-sm";
  heading.textContent = title;
  el.appendChild(heading);
  const body = document.createElement("div");
  body.className = "h-full";
  const ul = document.createElement("ul");
  for (let i = 0; i < rows; i++) ul.appendChild(document.createElement("li"));
  body.appendChild(ul);
  el.appendChild(body);
  return el;
};

describe("findDashboardCard", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("matches the trimmed, case-folded heading exactly by default", () => {
    const projects = card("  Projects ");
    const marks = card("Marks (12)");
    document.body.append(projects, marks);
    expect(document.querySelectorAll(DASHBOARD_CARD_SELECTOR).length).toBe(2);
    expect(findDashboardCard("PROJECTS")).toBe(projects);
    expect(findDashboardCard("MARKS")).toBeNull();
    expect(findDashboardCard("PRO")).toBeNull();
  });

  it("accepts a heading that carries a count with prefix", () => {
    const marks = card("Marks (12)");
    document.body.append(card("Projects"), marks);
    expect(findDashboardCard("MARKS", { prefix: true })).toBe(marks);
  });

  it("ignores a card whose heading is missing", () => {
    const bare = document.createElement("div");
    bare.className = "bg-white md:h-96";
    bare.textContent = "PROJECTS";
    document.body.append(bare);
    expect(findDashboardCard("PROJECTS")).toBeNull();
  });
});

describe("waitForDashboardCard", () => {
  // Frames are paced by hand: each flush is one animation frame.
  let queued: FrameRequestCallback[] = [];
  beforeEach(() => {
    document.body.replaceChildren();
    queued = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) {
      const batch = queued;
      queued = [];
      for (const cb of batch) cb(performance.now());
      // let the awaiting loop iteration run and re-arm before the next frame
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  it("resolves with a card that shows up later", async () => {
    const pending = waitForDashboardCard("PROJECTS", { maxFrames: 10 });
    await frames(3);
    const projects = card("Projects");
    document.body.append(projects);
    await frames(1);
    await expect(pending).resolves.toBe(projects);
  });

  it("gives up with null once the frame budget is spent", async () => {
    let settled: HTMLElement | null | undefined;
    void waitForDashboardCard("PROJECTS", { maxFrames: 5 }).then((c) => {
      settled = c;
    });
    await frames(4);
    expect(settled).toBeUndefined();
    await frames(1);
    expect(settled).toBeNull();
  });

  it("holds for `ready`, then takes the card after the grace", async () => {
    const empty = card("Projects");
    document.body.append(empty);
    let settled: HTMLElement | null | undefined;
    void waitForDashboardCard("PROJECTS", {
      maxFrames: 100,
      ready: (c) => !!c.querySelector("li"),
      readyGraceFrames: 3,
    }).then((c) => {
      settled = c;
    });
    await frames(2);
    expect(settled).toBeUndefined();
    await frames(2);
    expect(settled).toBe(empty);
  });

  it("returns as soon as `ready` passes", async () => {
    document.body.append(card("Projects", 2));
    let settled: HTMLElement | null | undefined;
    void waitForDashboardCard("PROJECTS", {
      ready: (c) => !!c.querySelector("li"),
      readyGraceFrames: 30,
    }).then((c) => {
      settled = c;
    });
    await Promise.resolve();
    expect(settled).not.toBeUndefined();
  });
});
