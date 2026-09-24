/**
 * @vitest-environment node
 *
 * scripts/release-state.mjs, the first step of finish-release.yaml: what it
 * completes for a release, and above all when it keeps out of publish.yaml's
 * way (1.15.0 got its Chrome files and updates.xml from finish-release while
 * publish.yaml was still running the tests those files failed).
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  releaseState,
  collect,
  jsonVersions,
  xmlVersions,
  compareVersions,
  SETTLE_MS,
  AMO_ALARM_FROM_MS,
  AMO_ALARM_UNTIL_MS,
  CHROME_RETRY_UNTIL_MS,
} from "../scripts/release-state.mjs";

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.parse("2026-09-24T18:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

const updatesJson = (...versions: string[]) =>
  JSON.stringify({ addons: { "better-intra@maitoxx.github": { updates: versions.map((version) => ({ version, update_link: "x" })) } } });
const updatesXml = (version: string) =>
  `<gupdate><app appid='a'><updatecheck codebase='https://x/v${version}/better-intra.crx' version='${version}' /></app></gupdate>`;

const ALL = ["better-intra-chrome.zip", "better-intra.crx", "better-intra.xpi", "chrome-web-store-upload.zip"];

const base = {
  tag: "v1.16.1",
  assets: ALL,
  publishedAt: ago(2 * 60 * MIN),
  openPublishRuns: 0,
  updatesJson: updatesJson("1.16.1", "1.16.0"),
  updatesXml: updatesXml("1.16.1"),
  hasAmo: true,
  hasCrx: true,
  now: NOW,
};

describe("release-state: nothing to do", () => {
  it("a complete release: no action and no notice", () => {
    const { outputs, notices } = releaseState(base);
    expect(outputs).toMatchObject({ tag: "v1.16.1", version: "1.16.1", need_chrome: false, need_xpi: false, need_updates_xml: false });
    expect(notices).toEqual([]);
  });

  it("the store package alone does not count as the Chrome files", () => {
    const { outputs } = releaseState({ ...base, assets: ["better-intra.xpi", "chrome-web-store-upload.zip"] });
    expect(outputs.need_chrome).toBe(true);
  });
});

describe("release-state: never alongside publish.yaml", () => {
  const empty = { ...base, assets: [] as string[] };

  it("holds everything back while a publish.yaml run for the tag is not finished", () => {
    const { outputs, notices } = releaseState({ ...empty, openPublishRuns: 1, publishedAt: ago(3 * 60 * MIN) });
    expect(outputs).toMatchObject({ need_chrome: false, need_xpi: false, need_updates_xml: false });
    expect(notices.join(" ")).toMatch(/publish\.yaml is still running for v1\.16\.1/);
  });

  it("holds everything back in the release's first 30 minutes (the 1.15.0 run came one minute in)", () => {
    for (const age of [MIN, SETTLE_MS - MIN]) {
      const { outputs, notices } = releaseState({ ...empty, publishedAt: ago(age) });
      expect(outputs.need_chrome, String(age)).toBe(false);
      expect(outputs.need_xpi, String(age)).toBe(false);
      expect(notices.join(" ")).toMatch(/less than 30 minutes ago/);
    }
    expect(SETTLE_MS).toBe(30 * MIN);
  });

  it("acts once publish.yaml is done and the release has settled", () => {
    const { outputs } = releaseState({ ...empty, publishedAt: ago(SETTLE_MS) });
    expect(outputs).toMatchObject({ need_chrome: true, need_xpi: true });
  });

  it("stops rebuilding Chrome files a day after the release (a gate that fails would fail every run), unless run by hand", () => {
    expect(releaseState({ ...empty, publishedAt: ago(CHROME_RETRY_UNTIL_MS - MIN) }).outputs.need_chrome).toBe(true);
    const late = releaseState({ ...empty, publishedAt: ago(CHROME_RETRY_UNTIL_MS) });
    expect(late.outputs.need_chrome).toBe(false);
    expect(late.notices.join(" ")).toMatch(/no Chrome files a day after its release/);
    // the .xpi keeps being looked for: AMO can take days
    expect(late.outputs.need_xpi).toBe(true);
    expect(releaseState({ ...empty, publishedAt: ago(CHROME_RETRY_UNTIL_MS * 3), manual: true }).outputs.need_chrome).toBe(true);
  });

  it("an unreadable publication date counts as too young, never as old", () => {
    expect(releaseState({ ...empty, publishedAt: null as unknown as string }).outputs.need_chrome).toBe(false);
  });
});

describe("release-state: what it completes", () => {
  it("no .xpi to fetch without AMO credentials (publish.yaml attaches the unsigned one)", () => {
    const { outputs } = releaseState({ ...base, assets: ["better-intra-chrome.zip"], hasAmo: false });
    expect(outputs.need_xpi).toBe(false);
  });

  it("repairs updates.json through the .xpi path when the push after the attach failed", () => {
    const { outputs, notices } = releaseState({ ...base, updatesJson: updatesJson("1.16.0", "1.15.0") });
    expect(outputs.need_xpi).toBe(true);
    expect(notices.join(" ")).toMatch(/updates\.json on main does not list 1\.16\.1/);
  });

  it("repairs updates.xml on its own, without rebuilding the Chrome files", () => {
    const { outputs } = releaseState({ ...base, updatesXml: updatesXml("1.16.0") });
    expect(outputs).toMatchObject({ need_updates_xml: true, need_chrome: false, need_xpi: false });
  });

  it("never 'repairs' a manifest that already lists a newer version (an older tag run by hand)", () => {
    const { outputs } = releaseState({
      ...base,
      tag: "v1.15.0",
      updatesJson: updatesJson("1.16.0"),
      updatesXml: updatesXml("1.16.0"),
    });
    expect(outputs).toMatchObject({ need_xpi: false, need_updates_xml: false });
  });

  it("no updates.xml repair without a .crx on the release or without the key", () => {
    const behind = { ...base, updatesXml: updatesXml("1.16.0") };
    expect(releaseState({ ...behind, assets: ALL.filter((a) => a !== "better-intra.crx") }).outputs.need_updates_xml).toBe(false);
    expect(releaseState({ ...behind, hasCrx: false }).outputs.need_updates_xml).toBe(false);
  });

  it("a prerelease is left alone: nothing signed, nothing in the update manifests", () => {
    const { outputs, notices } = releaseState({ ...base, assets: [], prerelease: true, updatesJson: "", updatesXml: "" });
    expect(outputs).toMatchObject({ need_chrome: false, need_xpi: false, need_updates_xml: false });
    expect(notices.join(" ")).toMatch(/prerelease/);
  });
});

describe("release-state: when a missing or refused version raises an alarm", () => {
  const noXpi = { ...base, assets: ["better-intra-chrome.zip", "better-intra.crx"] };
  const alarm = (age: number, manual = false) => releaseState({ ...noXpi, publishedAt: ago(age), manual }).outputs.amo_alarm;

  it("from an hour to a day after the release, on a schedule", () => {
    expect(alarm(AMO_ALARM_FROM_MS - MIN)).toBe(false);
    expect(alarm(AMO_ALARM_FROM_MS)).toBe(true);
    expect(alarm(AMO_ALARM_UNTIL_MS - MIN)).toBe(true);
    // a version that is never coming must not send 48 e-mails a day
    expect(alarm(AMO_ALARM_UNTIL_MS)).toBe(false);
  });

  it("always on a manual run", () => {
    expect(alarm(AMO_ALARM_UNTIL_MS * 3, true)).toBe(true);
    expect(alarm(SETTLE_MS, true)).toBe(true);
  });
});

describe("release-state: reading the manifests", () => {
  it("reads every version of the real updates.json and the one of updates.xml", () => {
    const json = jsonVersions(fs.readFileSync(path.join(ROOT, "updates.json"), "utf8"));
    expect(json.length).toBeGreaterThan(1);
    for (const v of json) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    const xml = xmlVersions(fs.readFileSync(path.join(ROOT, "updates.xml"), "utf8"));
    // (not compared with updates.json: while Mozilla reviews a version,
    // updates.xml already announces it and updates.json does not yet)
    expect(xml).toHaveLength(1);
    expect(xml[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("garbage reads as no version, and versions compare as numbers", () => {
    expect(jsonVersions("<html>")).toEqual([]);
    expect(xmlVersions("")).toEqual([]);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.16.0", "1.16.0")).toBe(0);
  });
});

describe("release-state: what it asks GitHub", () => {
  const RELEASE = {
    tagName: "v1.16.1",
    assets: [{ name: "better-intra.xpi" }, { name: "better-intra.crx" }, { name: "better-intra-chrome.zip" }],
    publishedAt: "2026-09-24T16:00:00Z",
    isPrerelease: false,
  };

  it("the latest release, its publish.yaml runs by tag, and the manifests on main", () => {
    const gh = vi.fn((args: string[]) => {
      if (args[0] === "release") return JSON.stringify(RELEASE);
      if (args[0] === "run") return JSON.stringify([{ status: "completed" }, { status: "in_progress" }, { status: "queued" }]);
      if (args[1].includes("updates.json")) return updatesJson("1.16.0");
      if (args[1].includes("updates.xml")) return updatesXml("1.16.1");
      throw new Error(args.join(" "));
    });
    const facts = collect({ gh, repo: "o/r", tag: "", hasAmo: true, hasCrx: true });
    expect(gh.mock.calls[0][0].slice(0, 3)).toEqual(["release", "view", "--repo"]);
    const run = gh.mock.calls.find(([a]) => a[0] === "run")![0];
    // a release event's run carries the tag as its branch
    expect(run).toEqual(expect.arrayContaining(["--workflow", "publish.yaml", "--branch", "v1.16.1"]));
    const api = gh.mock.calls.filter(([a]) => a[0] === "api").map(([a]) => a[1]);
    expect(api).toEqual(["repos/o/r/contents/updates.json?ref=main", "repos/o/r/contents/updates.xml?ref=main"]);
    expect(facts).toMatchObject({ tag: "v1.16.1", openPublishRuns: 2, prerelease: false });
    expect(facts.assets).toEqual(["better-intra.xpi", "better-intra.crx", "better-intra-chrome.zip"]);
  });

  it("a named tag is asked for by name; a manifest missing on main reads as empty", () => {
    const gh = vi.fn((args: string[]) => {
      if (args[0] === "release") return JSON.stringify(RELEASE);
      if (args[0] === "run") return "[]";
      throw Object.assign(new Error("gh: Not Found (HTTP 404)"), { stderr: "gh: Not Found (HTTP 404)" });
    });
    const facts = collect({ gh, repo: "o/r", tag: "v1.16.1", hasAmo: true, hasCrx: true });
    expect(gh.mock.calls[0][0].slice(0, 3)).toEqual(["release", "view", "v1.16.1"]);
    expect(facts.updatesJson).toBe("");
    expect(facts.updatesXml).toBe("");
  });

  it("any other GitHub error stops the run instead of guessing", () => {
    const gh = vi.fn((args: string[]) => {
      if (args[0] === "release") return JSON.stringify(RELEASE);
      if (args[0] === "run") return "[]";
      throw Object.assign(new Error("HTTP 502"), { stderr: "gh: Bad Gateway (HTTP 502)" });
    });
    expect(() => collect({ gh, repo: "o/r", tag: "", hasAmo: true, hasCrx: true })).toThrow(/502/);
  });
});
