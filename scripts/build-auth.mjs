/**
 * The last step of build:chrome, build:firefox and the watch scripts:
 * auth-callback.js, the content script of the worker's OAuth callback page.
 *
 *   cross-env TARGET=chrome BUILD_OUT_DIR=dist-chrome node scripts/build-auth.mjs [--watch]
 *
 * Built only in package.json config.authMode "oauth". In "intra" mode (this
 * deployment) finalizeManifest() registers no callback script, so the file
 * never ran, yet it shipped in every package (19 KB: the i18n start-up pulls
 * in every setting's default) and sat 0.8 KB under its size budget, a
 * tripwire on dead code that could stop a release. Every vite config has
 * emptyOutDir: false, so a copy left by an older build is removed here, or
 * local packages and budgets would still carry it.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readAuthMode } from "./repo-info.js";

export const AUTH_CALLBACK_FILE = "auth-callback.js";

/**
 * Builds (oauth) or removes a stale copy (intra); returns the exit code.
 * `spawn` runs vite and returns its exit status (injectable for tests).
 */
export function runAuthBuild({ authMode, outDir, args = [], spawn, log = console.log }) {
  if (authMode === "oauth") {
    return spawn(["build", "--config", "vite.auth.config.ts", ...args]);
  }
  const stale = path.join(outDir, AUTH_CALLBACK_FILE);
  if (fs.existsSync(stale)) {
    fs.rmSync(stale);
    log(`build-auth: removed ${stale} (authMode "${authMode}" registers no callback script)`);
  }
  return 0;
}

function main() {
  const require = createRequire(import.meta.url);
  const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), require("vite/package.json").bin.vite);
  const code = runAuthBuild({
    authMode: readAuthMode(),
    outDir: process.env.BUILD_OUT_DIR || "dist",
    args: process.argv.slice(2),
    spawn: (viteArgs) => spawnSync(process.execPath, [viteBin, ...viteArgs], { stdio: "inherit" }).status ?? 1,
  });
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
