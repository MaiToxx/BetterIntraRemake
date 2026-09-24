import { defineConfig } from "vite";
import { frCatalogPlugin } from "./scripts/i18n-catalog.ts";
import { resolve } from "path";
import pkg from "./package.json" with { type: "json" };
import { readRepoInfo, readWorkerUrl, readAuthMode } from "./scripts/repo-info.js";

const target = (process.env.TARGET || "firefox") as "firefox" | "chrome";
const outDir = process.env.BUILD_OUT_DIR || "dist";
const repo = readRepoInfo();
const workerUrl = readWorkerUrl();
const authMode = readAuthMode();
// See vite.config.ts.
const storeBuild = process.env.CHROME_STORE === "1";

export default defineConfig({
  plugins: [frCatalogPlugin()],
  build: {
    outDir: outDir,
    emptyOutDir: false,
    minify: true,
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
    __AUTH_MODE__: JSON.stringify(authMode),
    __STORE_BUILD__: JSON.stringify(storeBuild),
    __TARGET__: JSON.stringify(target),
  },
});
