import { defineConfig } from "vitest/config";

export default defineConfig({
  // Build-time constants injected by vite.config.ts; needed so that modules
  // importing hubSettings.data.ts can be loaded in tests.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
    __REPO_URL__: JSON.stringify("https://github.com/test/better-intra"),
    __REPO_RELEASES_API__: JSON.stringify(
      "https://api.github.com/repos/test/better-intra/releases/latest",
    ),
    __WORKER_URL__: JSON.stringify("https://api.betterintra.com"),
    __TS_VERSION__: JSON.stringify("test"),
    __VITE_VERSION__: JSON.stringify("test"),
    __LIT_VERSION__: JSON.stringify("test"),
    __TW_VERSION__: JSON.stringify("test"),
    __DAISY_VERSION__: JSON.stringify("test"),
    __WEB_EXT_VERSION__: JSON.stringify("test"),
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});
