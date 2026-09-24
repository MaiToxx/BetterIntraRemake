/**
 * @vitest-environment node
 *
 * The smoke harness's exit codes, and what CI does with them. Exit 2 used to
 * mean "no Chrome found" and "the harness crashed" alike, and ci.yaml turned
 * 2 into a warning: a broken harness passed every CI run as "skipped". Now
 * only 3 (nothing to run on) is soft, and a crash exits 2.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXIT_UNAVAILABLE,
  exitCodeFor,
  loadPuppeteer,
  resolveChrome,
  resolveFirefox,
} from "../scripts/firefox-smoke/browsers.mjs";

const ROOT = path.resolve(__dirname, "..");

/** The error `fn` throws (sync or async). */
async function thrown(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("did not throw");
}

describe("smoke harness: nothing to run on", () => {
  it("no Chrome on the usual paths, or no Firefox under .browsers/, exits 3", async () => {
    expect(EXIT_UNAVAILABLE).toBe(3);
    expect(exitCodeFor(await thrown(() => resolveChrome(null, [])))).toBe(3);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "bi-nofirefox-"));
    try {
      expect(exitCodeFor(await thrown(() => resolveFirefox(null, empty)))).toBe(3);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("an explicit browser path that does not exist is the caller's mistake: 2", async () => {
    const missing = path.join(os.tmpdir(), "bi-no-such-browser.exe");
    expect(exitCodeFor(await thrown(() => resolveChrome(missing)))).toBe(2);
    expect(exitCodeFor(await thrown(() => resolveFirefox(missing, os.tmpdir())))).toBe(2);
  });

  it("puppeteer-core missing is 3; a module missing inside it, or any other error, is a crash (2)", async () => {
    const notInstalled = Object.assign(new Error("Cannot find package 'puppeteer-core' imported from /x/browsers.mjs"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(exitCodeFor(await thrown(() => loadPuppeteer(() => Promise.reject(notInstalled))))).toBe(3);
    const broken = Object.assign(new Error("Cannot find module '/x/node_modules/puppeteer-core/lib/esm/gone.js'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(exitCodeFor(await thrown(() => loadPuppeteer(() => Promise.reject(broken))))).toBe(2);
    expect(exitCodeFor(new SyntaxError("Unexpected token"))).toBe(2);
    expect(exitCodeFor("a string")).toBe(2);
  });

  it("finds a Chrome that is there", () => {
    const fake = path.join(os.tmpdir(), `bi-fake-chrome-${process.pid}`);
    fs.writeFileSync(fake, "");
    try {
      expect(resolveChrome(null, ["/nope/chrome", fake])).toBe(fake);
    } finally {
      fs.rmSync(fake, { force: true });
    }
  });
});

describe("smoke harness: a crash fails, it is not 'no Chrome'", () => {
  it("a build folder with an unreadable manifest crashes the harness with exit 2", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bi-badbuild-"));
    try {
      fs.writeFileSync(path.join(dir, "manifest.json"), "{not json");
      const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/firefox-smoke.mjs"), dir, "--browser", "chrome"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/SyntaxError/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ci.yaml soft-skips exit 3 and only 3", () => {
    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yaml"), "utf8").replace(/\r\n/g, "\n");
    const at = ci.indexOf("- name: Smoke test (Chrome)");
    const step = ci.slice(at, ci.indexOf("\n      - ", at + 1));
    expect(step).toContain('if [ "$code" -eq 3 ]; then');
    expect(step).not.toMatch(/-eq 2|-ne 1|\|\| true/);
    expect(step).toContain('exit "$code"');
    // the release gate has no such exception at all
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["release:check"]).toMatch(/&& node scripts\/firefox-smoke\.mjs dist-chrome --browser chrome [^&|;]*$/);
  });
});
