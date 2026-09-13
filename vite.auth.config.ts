import { defineConfig } from "vite";
import { resolve } from "path";
import pkg from "./package.json" with { type: "json" };
import { readRepoInfo } from "./scripts/repo-info.js";

// Content script injected on the worker's OAuth callback page.
const outDir = process.env.BUILD_OUT_DIR || "dist";
const repo = readRepoInfo();

export default defineConfig({
  build: {
    outDir: outDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: {
        "auth-callback": resolve(import.meta.dirname, "src/auth-callback.ts"),
      },
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
  },
});
