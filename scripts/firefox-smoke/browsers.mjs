/**
 * Finding what the smoke harness runs on (a Firefox, a Chrome, puppeteer-core)
 * and the exit codes it reports when it stops before any check ran.
 *
 * Exit codes of scripts/firefox-smoke.mjs: 0 every check passed, 1 a check
 * failed, 2 a usage error or a crash of the harness, 3 nothing to run on (no
 * browser found, puppeteer-core not installed). CI soft-skips 3 and only 3:
 * when a crash also exited 2 like "no Chrome found", a broken harness passed
 * CI as "skipped" and stopped protecting anything without anyone noticing.
 */
import fs from "node:fs";
import path from "node:path";

export const EXIT_USAGE = 2;
export const EXIT_UNAVAILABLE = 3;

/** A stop the harness explains in one line (no stack), with its exit code. */
export class HarnessStop extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const unavailable = (message) => new HarnessStop(message, EXIT_UNAVAILABLE);
const setupError = (message) => new HarnessStop(message, EXIT_USAGE);

/** The exit code for whatever stopped main(): anything unexpected is a crash. */
export function exitCodeFor(error) {
  return error instanceof HarnessStop ? error.code : EXIT_USAGE;
}

/**
 * The Firefox binary: `explicit`, else the newest one under `base` (the
 * portable copies `npx @puppeteer/browsers install firefox@stable --path
 * .browsers` writes). A path given explicitly that does not exist is a
 * mistake of the caller (2); an empty `base` means there is none (3).
 */
export function resolveFirefox(explicit, base) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw setupError(`Firefox not found at ${explicit}`);
    return explicit;
  }
  const candidates = [];
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      for (const rel of [
        ["core", "firefox.exe"],
        ["firefox", "firefox"],
        ["Firefox.app", "Contents", "MacOS", "firefox"],
        ["Firefox Nightly.app", "Contents", "MacOS", "firefox"],
      ]) {
        const p = path.join(base, d, ...rel);
        if (fs.existsSync(p)) candidates.push(p);
      }
    }
  }
  if (!candidates.length) {
    throw unavailable(`no Firefox under ${base}; pass --firefox PATH or set FIREFOX_BIN`);
  }
  // Highest version first (folder names like win64-stable_156.0).
  const ver = (p) => (/_(\d+)(?:\.(\d+))?/.exec(p) || []).slice(1).map(Number);
  candidates.sort((a, b) => {
    const [a1 = 0, a2 = 0] = ver(a);
    const [b1 = 0, b2 = 0] = ver(b);
    return b1 - a1 || b2 - a2;
  });
  return candidates[0];
}

export const CHROME_DEFAULTS = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"],
};

/** The Chrome binary: `explicit`, else the first of the platform's usual paths. */
export function resolveChrome(explicit, candidates = CHROME_DEFAULTS[process.platform] || []) {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw setupError(`Chrome not found at ${explicit}`);
    return explicit;
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw unavailable("no Chrome found; pass --chrome PATH or set CHROME_BIN");
  return found;
}

/**
 * puppeteer-core, or exit 3 when the package itself is not installed. Only
 * that: a module missing inside an installed puppeteer-core (a broken
 * upgrade) is a crash, not a runner without the tool.
 */
export async function loadPuppeteer(load = () => import("puppeteer-core")) {
  try {
    return (await load()).default;
  } catch (e) {
    if (e && e.code === "ERR_MODULE_NOT_FOUND" && /Cannot find package 'puppeteer-core'/.test(String(e.message))) {
      throw unavailable("puppeteer-core is not installed: npm install --no-save puppeteer-core");
    }
    throw e;
  }
}
