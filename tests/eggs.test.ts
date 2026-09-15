import { describe, it, expect, beforeEach } from "vitest";
import {
  EGG_IDS,
  createSequenceMatcher,
  listFoundEggs,
  recordEgg,
} from "../src/features/eggs/eggs";

beforeEach(() => {
  (chrome.storage.local.clear as any)();
});

describe("createSequenceMatcher", () => {
  it("matches the konami code and typed words, case-insensitively", () => {
    const hits: string[] = [];
    const feed = createSequenceMatcher(
      { konami: ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"], barrel: [..."barrel"] },
      (id) => hits.push(id),
    );
    for (const k of ["x", "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "B", "A"]) feed(k);
    expect(hits).toEqual(["konami"]);
    for (const k of [..."xxBARREL"]) feed(k);
    expect(hits).toEqual(["konami", "barrel"]);
    // buffer is cleared after a match: "rel" alone must not re-trigger
    for (const k of [..."rel"]) feed(k);
    expect(hits).toEqual(["konami", "barrel"]);
  });
});

describe("found eggs", () => {
  it("records each secret once and ignores unknown ids", async () => {
    expect(await listFoundEggs()).toEqual([]);
    expect(await recordEgg("konami")).toBe(true);
    expect(await recordEgg("konami")).toBe(false);
    expect(await recordEgg("matrix")).toBe(true);
    expect(await listFoundEggs()).toEqual(["konami", "matrix"]);
    await chrome.storage.local.set({ EGGS_FOUND: ["bogus", "night"] });
    expect(await listFoundEggs()).toEqual(["night"]);
    expect(EGG_IDS.length).toBe(8);
    expect(EGG_IDS).toContain("maxwell");
  });
});
