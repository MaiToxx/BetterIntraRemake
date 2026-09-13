import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import fs from "fs";
import { cp } from "fs/promises";
import pkg from "./package.json" with { type: "json" };
import { readRepoInfo } from "./scripts/repo-info.js";

const target = (process.env.TARGET || "firefox") as "firefox" | "chrome";
const outDir = process.env.BUILD_OUT_DIR || "dist";
const repo = readRepoInfo();

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
        if (target === "firefox") {
          // Firefox auto-update: id and update manifest derived from the
          // repository this fork lives in (package.json "repository").
          const gecko = (manifest.browser_specific_settings ??= {}).gecko ??= {};
          gecko.id = repo.geckoId;
          gecko.update_url = repo.updatesJsonUrl;
        } else {
          // Chrome self-hosted updates (.crx + updates.xml). Ignored for
          // unpacked installs and on Windows/macOS, harmless there.
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
      },
    },
  ],
  build: {
    outDir: outDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: { content: resolve(import.meta.dirname, "src/main.ts") },
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
    __TS_VERSION__: JSON.stringify(pkg.devDependencies.typescript),
    __VITE_VERSION__: JSON.stringify(pkg.devDependencies.vite),
    __LIT_VERSION__: JSON.stringify(pkg.dependencies["lit-html"]),
    __TW_VERSION__: JSON.stringify(pkg.dependencies["@tailwindcss/vite"]),
    __DAISY_VERSION__: JSON.stringify(pkg.devDependencies.daisyui),
    __WEB_EXT_VERSION__: JSON.stringify(pkg.devDependencies["web-ext"]),
    "import.meta": "{}",
  },
});
