/**
 * @vitest-environment node
 *
 * scripts/build-auth.mjs, the last build step: auth-callback.js only serves
 * the dormant OAuth flow, so intra builds no longer carry it (19 KB of dead
 * code 0.8 KB under its size budget, a tripwire that could stop a release).
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAuthBuild, AUTH_CALLBACK_FILE } from "../scripts/build-auth.mjs";

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const log = () => {};

describe("build-auth", () => {
  it("intra mode: builds nothing and removes the copy an older build left (emptyOutDir is false)", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bi-auth-"));
    try {
      fs.writeFileSync(path.join(out, AUTH_CALLBACK_FILE), "old");
      const spawn = vi.fn(() => 0);
      expect(runAuthBuild({ authMode: "intra", outDir: out, spawn, log })).toBe(0);
      expect(spawn).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(out, AUTH_CALLBACK_FILE))).toBe(false);
      // and a clean folder is fine too
      expect(runAuthBuild({ authMode: "intra", outDir: out, spawn, log })).toBe(0);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("oauth mode: runs vite with the auth config, --watch passed through, and reports its exit code", () => {
    const spawn = vi.fn(() => 7);
    expect(runAuthBuild({ authMode: "oauth", outDir: "unused", args: ["--watch"], spawn, log })).toBe(7);
    expect(spawn).toHaveBeenCalledWith(["build", "--config", "vite.auth.config.ts", "--watch"]);
  });

  it("every build and watch script goes through it; the store build still skips it", () => {
    for (const name of ["build:chrome", "build:firefox", "watch:chrome", "watch:firefox"]) {
      const script = String(pkg.scripts[name]);
      expect(script, name).toContain("node scripts/build-auth.mjs");
      expect(script, name).not.toContain("vite.auth.config.ts");
    }
    expect(pkg.scripts["watch:chrome"]).toContain("node scripts/build-auth.mjs --watch");
    expect(pkg.scripts["watch:firefox"]).toContain("node scripts/build-auth.mjs --watch");
    expect(pkg.scripts["build:chrome-store"]).not.toMatch(/build-auth|vite\.auth\.config/);
  });
});
