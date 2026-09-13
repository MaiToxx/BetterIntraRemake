import { defineConfig } from "vite";
import { resolve } from "path";
import pkg from "./package.json" with { type: "json" };
import { readRepoInfo, readWorkerUrl } from "./scripts/repo-info.js";

const target = (process.env.TARGET || "firefox") as "firefox" | "chrome";
const outDir = process.env.BUILD_OUT_DIR || "dist";
const repo = readRepoInfo();
const workerUrl = readWorkerUrl();

export default defineConfig({
  build: {
    outDir: outDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: { background: resolve(import.meta.dirname, "src/background.ts") },
      output: {
        format: "iife",
        entryFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __REPO_URL__: JSON.stringify(repo.url),
    __REPO_RELEASES_API__: JSON.stringify(repo.releasesApi),
    __WORKER_URL__: JSON.stringify(workerUrl),
  },
});
