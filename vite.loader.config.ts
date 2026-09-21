import { defineConfig } from "vite";
import { resolve } from "path";
import { noPreloadHelperPlugin } from "./vite.config.ts";

/**
 * content.js: src/loader.ts as a classic script (IIFE), the one content script
 * both manifests declare on the Intra, at document_start. It injects hook.js,
 * applies the cached theme, pre-hides the avatar and imports content-main.js,
 * which vite.config.ts builds. See docs/CODE-SPLITTING.md.
 *
 * Its own build because the app is an ES module graph and a content script
 * cannot be one. It must stay tiny and stateless: it only bundles loader.ts
 * and constant modules (tests/split-build.test.ts fails if chrome.storage
 * shows up in it or if it grows past a few KB).
 */
const outDir = process.env.BUILD_OUT_DIR || "dist";

export default defineConfig({
  // No second copy of public/: the content build already put hook.js there.
  publicDir: false,
  plugins: [noPreloadHelperPlugin()],
  build: {
    outDir,
    emptyOutDir: false,
    minify: true,
    modulePreload: false,
    rollupOptions: {
      input: { content: resolve(import.meta.dirname, "src/loader.ts") },
      output: {
        format: "iife",
        entryFileNames: "[name].js",
      },
    },
  },
});
