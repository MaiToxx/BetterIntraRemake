import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import fs from "fs";
import { cp } from "fs/promises";
import pkg from "./package.json" with { type: "json" };
import { readRepoInfo, readWorkerUrl, DEFAULT_WORKER_URL, readAuthMode } from "./scripts/repo-info.js";

const target = (process.env.TARGET || "firefox") as "firefox" | "chrome";
const outDir = process.env.BUILD_OUT_DIR || "dist";
const repo = readRepoInfo();
const workerUrl = readWorkerUrl();
const authMode = readAuthMode();

/** Name of the compiled Tailwind/daisyUI asset; see src/assets/shared-styles.ts. */
const SHARED_CSS_FILE = "shared-styles.css";

/**
 * Theme sheets served as files rather than JS strings: theme-dark-v2.css alone
 * is 55 KB that profile-v3 never needs, and a <link> lets the browser cache and
 * parse each of them once. They are plain CSS (no Tailwind at-rules, and every
 * url() is a data URI), so a verbatim copy is faithful. Must stay in sync with
 * THEME_SHEETS in src/features/profile/theme/theme-manager.ts and with
 * web_accessible_resources in both manifests.
 */
const THEME_CSS_FILES = [
  "theme-dark-v2.css",
  "theme-dark-v3.css",
  "theme-light-default-v3.css",
  "theme-light-v3.css",
];

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: "write-manifest",
      closeBundle() {
        const manifestSrc = resolve(
          import.meta.dirname,
          `manifests/manifest.${target}.json`,
        );
        const manifestDst = resolve(import.meta.dirname, `${outDir}/manifest.json`);

        if (!fs.existsSync(manifestSrc)) {
          console.error(`\nManifest not found: ${manifestSrc}\n`);
          return;
        }

        const manifest = JSON.parse(fs.readFileSync(manifestSrc, "utf-8"));
        manifest.version = pkg.version;
        // Self-hosted worker: rewrite the upstream origin in host permissions
        // and content script matches (package.json config.workerUrl).
        if (workerUrl !== DEFAULT_WORKER_URL) {
          const swap = (s: string) => s.replace(DEFAULT_WORKER_URL, workerUrl);
          manifest.host_permissions = (manifest.host_permissions ?? []).map(swap);
          for (const cs of manifest.content_scripts ?? []) {
            cs.matches = (cs.matches ?? []).map(swap);
          }
        }
        if (target === "firefox") {
          // Firefox auto-update: id and update manifest derived from the
          // repository this fork lives in (package.json "repository").
          const gecko = (manifest.browser_specific_settings ??= {}).gecko ??= {};
          gecko.id = repo.geckoId;
          gecko.update_url = repo.updatesJsonUrl;
        } else if (process.env.CHROME_STORE !== "1") {
          // Chrome self-hosted updates (.crx + updates.xml). Ignored for
          // unpacked installs and on Windows/macOS, harmless there. The Chrome
          // Web Store build (CHROME_STORE=1) must not carry an update_url.
          manifest.update_url = repo.updatesXmlUrl;
        }
        fs.writeFileSync(
          manifestDst,
          JSON.stringify(manifest, null, 2),
          "utf-8",
        );
        console.log(`\nmanifest.json written for ${target} v${pkg.version}\n`);
        // Copy icons
        const iconsSrc = resolve(import.meta.dirname, "public/icons");
        const iconsDst = resolve(import.meta.dirname, `${outDir}/icons`);
        if (fs.existsSync(iconsSrc)) {
          fs.mkdirSync(iconsDst, { recursive: true });
          for (const file of fs.readdirSync(iconsSrc)) {
            fs.cpSync(resolve(iconsSrc, file), resolve(iconsDst, file));
          }
          console.log(`icons copied to ${iconsDst}`);
        }
        // Theme sheets: copied as-is so theme-manager.ts can <link> them.
        const themeSrc = resolve(
          import.meta.dirname,
          "src/features/profile/theme",
        );
        for (const file of THEME_CSS_FILES) {
          const from = resolve(themeSrc, file);
          if (!fs.existsSync(from)) {
            console.error(`\nTheme stylesheet not found: ${from}\n`);
            continue;
          }
          fs.cpSync(from, resolve(import.meta.dirname, `${outDir}/${file}`));
        }
        console.log(`${THEME_CSS_FILES.length} theme stylesheets copied`);
      },
    },
  ],
  build: {
    outDir: outDir,
    emptyOutDir: false,
    minify: true,
    // Without this Vite injects the compiled Tailwind sheet back into the IIFE
    // (there is no HTML entry to link it from). We want it on disk: ~300 KB out
    // of content.js, parsed once by the browser instead of once per shadow root.
    cssCodeSplit: false,
    rollupOptions: {
      input: { content: resolve(import.meta.dirname, "src/main.ts") },
      output: {
        format: "iife",
        entryFileNames: "[name].js",
        assetFileNames: (asset: { names?: string[]; name?: string }) => {
          const name = asset.names?.[0] ?? asset.name ?? "";
          // The one CSS asset of this build is src/assets/style.css compiled by
          // Tailwind. Give it the stable name that shared-styles.ts fetches and
          // that the manifests expose in web_accessible_resources.
          return name.endsWith(".css") ? SHARED_CSS_FILE : "[name].[ext]";
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __REPO_URL__: JSON.stringify(repo.url),
    __REPO_RELEASES_API__: JSON.stringify(repo.releasesApi),
    __WORKER_URL__: JSON.stringify(workerUrl),
    __AUTH_MODE__: JSON.stringify(authMode),
    __TS_VERSION__: JSON.stringify(pkg.devDependencies.typescript),
    __VITE_VERSION__: JSON.stringify(pkg.devDependencies.vite),
    __LIT_VERSION__: JSON.stringify(pkg.dependencies["lit-html"]),
    __TW_VERSION__: JSON.stringify(pkg.dependencies["@tailwindcss/vite"]),
    __DAISY_VERSION__: JSON.stringify(pkg.devDependencies.daisyui),
    __WEB_EXT_VERSION__: JSON.stringify(pkg.devDependencies["web-ext"]),
    "import.meta": "{}",
  },
});
