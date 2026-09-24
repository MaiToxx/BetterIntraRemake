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
    __AUTH_MODE__: JSON.stringify("oauth"),
    __STORE_BUILD__: JSON.stringify(false),
      __TARGET__: JSON.stringify("firefox"),
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
    // Above the longest vi.waitFor (8 s, for the slow CI runner): at the
    // default 5 s a case was cut short while its own wait still ran, and the
    // 1.15.0 release stopped at its tests.
    testTimeout: 20_000,
  },
});
