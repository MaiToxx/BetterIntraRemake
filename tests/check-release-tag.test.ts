/**
 * @vitest-environment node
 *
 * scripts/check-release-tag.mjs, the first step of both publish.yaml jobs:
 * the packages take their version from package.json, updates.json/xml and
 * the AMO lookups from the tag, so a forgotten bump announced a version the
 * packages did not carry, in runs that stayed green.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tagMatchesVersion } from "../scripts/check-release-tag.mjs";

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/check-release-tag.mjs");
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

describe("release tag vs package.json", () => {
  it("a release tag is exactly v<version>", () => {
    expect(tagMatchesVersion("v1.16.1", "1.16.1")).toBe(true);
    expect(tagMatchesVersion("v1.16.1", "1.16.0")).toBe(false);
    expect(tagMatchesVersion("1.16.1", "1.16.1")).toBe(false);
    expect(tagMatchesVersion("v1.16.10", "1.16.1")).toBe(false);
    // a suffix never passes a full release: the manifest cannot carry it
    expect(tagMatchesVersion("v1.16.1-rc1", "1.16.1")).toBe(false);
  });

  it("a prerelease may add a -suffix to the same version, nothing else", () => {
    const pre = { prerelease: true };
    expect(tagMatchesVersion("v1.17.0-rc1", "1.17.0", pre)).toBe(true);
    expect(tagMatchesVersion("v1.17.0", "1.17.0", pre)).toBe(true);
    expect(tagMatchesVersion("v1.17.0-", "1.17.0", pre)).toBe(false);
    expect(tagMatchesVersion("v1.17.01", "1.17.0", pre)).toBe(false);
    expect(tagMatchesVersion("v1.18.0-rc1", "1.17.0", pre)).toBe(false);
  });

  it("the command passes the current version and fails the job on another, with an annotation", () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
    expect(run(`v${version}`).status).toBe(0);
    const wrong = run("v0.0.1");
    expect(wrong.status).toBe(1);
    expect(wrong.stdout).toContain(`::error::release tag v0.0.1 but package.json says ${version}`);
    expect(run().status).toBe(2);
  });
});
