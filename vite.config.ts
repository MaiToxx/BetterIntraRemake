import { defineConfig, type Plugin } from "vite";
import { collapseLitTemplatesPlugin } from "./scripts/collapse-lit-templates.ts";
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

/** Name of the compiled Tailwind/daisyUI asset; see src/core/styles/shared-styles.ts. */
const SHARED_CSS_FILE = "shared-styles.css";

/**
 * The daisyUI themes that stay in shared-styles.css: the two a widget shows
 * when the hub preset is left alone (BETTER_INTRA_THEME). Must match
 * CORE_THEMES in src/core/styles/shared-styles.ts.
 */
export const CORE_THEMES: readonly string[] = ["light", "dark"];

/**
 * Where the other 34 hub presets go: a second asset, emitted next to
 * shared-styles.css, that shared-styles.ts loads only on a page whose preset
 * needs it. Must match THEMES_CSS_FILE in src/core/styles/shared-styles.ts and
 * web_accessible_resources in both manifests.
 */
export const SHARED_THEMES_CSS_FILE = "shared-themes.css";

type CssBlock = {
  /** Offset of the block's first character (its prelude). */
  start: number;
  /** Offset of its "{". */
  open: number;
  /** One past its closing "}". */
  end: number;
  /** The prelude: a selector list or an at-rule, trimmed. */
  head: string;
};

/**
 * The blocks (`head{...}`) directly inside css[from, to). Statements such as
 * `@layer a,b;` are skipped, and so are strings and comments, so a brace
 * inside them does not count.
 */
function cssBlocks(css: string, from: number, to: number): CssBlock[] {
  const out: CssBlock[] = [];
  let depth = 0;
  let start = from;
  let open = -1;
  for (let i = from; i < to; i++) {
    const c = css[i];
    if (c === "\\") {
      i++;
    } else if (c === '"' || c === "'") {
      for (i++; i < to && css[i] !== c; i++) if (css[i] === "\\") i++;
    } else if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close === -1 ? to : close + 1;
      if (depth === 0) start = i + 1;
    } else if (c === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (c === "}") {
      if (--depth < 0) throw new Error(`splitDaisyThemes: stray "}" at ${i}`);
      if (depth === 0) {
        out.push({ start, open, end: i + 1, head: css.slice(start, open).trim() });
        start = i + 1;
      }
    } else if (c === ";" && depth === 0) {
      start = i + 1;
    }
  }
  if (depth !== 0) throw new Error("splitDaisyThemes: unbalanced braces");
  return out;
}

const DATA_THEME = /\[data-theme=(["']?)([^"'\]\s]+)\1\]/g;

/**
 * The theme a daisyUI theme rule applies, or null for any other block. daisyUI
 * writes each theme as ONE rule (see `root` in style.css): its selector names a
 * single [data-theme=x] (plus a dead `:root:has(.theme-controller)` twin) and
 * its body sets the theme's variables, --color-base-100 among them.
 */
function daisyThemeOf(css: string, block: CssBlock): string | null {
  if (block.head.startsWith("@")) return null;
  const names = new Set([...block.head.matchAll(DATA_THEME)].map((m) => m[2]));
  if (names.size !== 1) return null;
  if (!/--color-base-100\s*:/.test(css.slice(block.open + 1, block.end - 1))) return null;
  return [...names][0];
}

/**
 * Split the compiled Tailwind/daisyUI sheet in two: `core` is the sheet minus
 * every daisyUI theme block other than `keep`, `themes` is those blocks in
 * `@layer base`, where they came from.
 *
 * WHY AFTER COMPILING. The blocks are cut out of the final CSS, after Vite's
 * own minification pass, instead of being compiled from a second source file:
 * that pass is not Tailwind's (it rewrites `color-scheme` into
 * --lightningcss-light/dark and wraps the selectors in :is()), a second CSS
 * import would be merged back into this one asset by `cssCodeSplit: false`,
 * and a sheet compiled on the side would not go through it. Cut out, the
 * blocks are byte for byte the ones the single sheet had.
 *
 * WHY THE CASCADE IS UNCHANGED. The moved blocks must be the tail of the one
 * `@layer base` block (this throws otherwise, e.g. if a daisyUI update
 * reorders its output). Then `core` followed by `themes` is the original sheet
 * with its last rules of layer base moved to a later sheet that re-opens the
 * same layer: same layer order, same rule order inside every layer, so the
 * same winner for every property. Loading `themes` anywhere after `core` is
 * enough, whatever unlayered widget rules sit in between: those beat any
 * layered rule regardless of order, and the theme blocks carry no !important.
 * Without `themes`, the only rules missing are [data-theme=<moved theme>]
 * ones (and their :root:has(.theme-controller) twins, dead since src/ never
 * renders a theme-controller), so light and dark resolve exactly as before.
 */
export function splitDaisyThemes(
  css: string,
  keep: readonly string[] = CORE_THEMES,
): { core: string; themes: string; moved: string[] } {
  const bases = cssBlocks(css, 0, css.length).filter((b) => /^@layer\s+base$/.test(b.head));
  // A second `@layer base` block (nested or not) would hold rules that came
  // after the moved ones and would end up before them.
  if (bases.length !== 1 || (css.match(/@layer\s+base\s*\{/g) ?? []).length !== 1) {
    throw new Error("splitDaisyThemes: expected exactly one top-level @layer base block");
  }
  const base = bases[0];
  const moved: CssBlock[] = [];
  const movedNames: string[] = [];
  const kept = new Set<string>();
  for (const block of cssBlocks(css, base.open + 1, base.end - 1)) {
    const name = daisyThemeOf(css, block);
    if (name !== null && !keep.includes(name)) {
      moved.push(block);
      movedNames.push(name);
      continue;
    }
    if (name !== null) kept.add(name);
    if (moved.length) {
      throw new Error(
        `splitDaisyThemes: "${block.head.slice(0, 80)}" follows a theme block in @layer base; moving the themes out would reorder the cascade`,
      );
    }
  }
  for (const name of keep) {
    if (!kept.has(name)) throw new Error(`splitDaisyThemes: no [data-theme=${name}] block left in the sheet`);
  }
  if (!moved.length) return { core: css, themes: "", moved: [] };
  const from = moved[0].start;
  const to = moved[moved.length - 1].end;
  if (css.slice(to, base.end - 1).trim() !== "") {
    throw new Error("splitDaisyThemes: something follows the theme blocks in @layer base");
  }
  return {
    core: css.slice(0, from) + css.slice(to),
    themes: `@layer base{${css.slice(from, to)}}`,
    moved: movedNames,
  };
}

/**
 * Applies splitDaisyThemes() to the emitted shared-styles.css and emits
 * shared-themes.css next to it. Both this build and vite.popup.config.ts
 * write shared-styles.css into the same folder, so both use this plugin and
 * write the same two files.
 */
export function splitDaisyThemesPlugin(): Plugin {
  return {
    name: "split-daisyui-themes",
    // After vite:css-post, which emits the sheet in its own generateBundle.
    enforce: "post",
    generateBundle(_options, bundle) {
      const asset = bundle[SHARED_CSS_FILE];
      if (!asset || asset.type !== "asset") {
        this.error(`${SHARED_CSS_FILE} is not in the bundle, so there are no themes to split out`);
      }
      const css =
        typeof asset.source === "string"
          ? asset.source
          : new TextDecoder().decode(asset.source);
      const { core, themes } = splitDaisyThemes(css);
      asset.source = core;
      this.emitFile({ type: "asset", fileName: SHARED_THEMES_CSS_FILE, source: themes });
    },
  };
}

/**
 * Theme sheets served as files rather than JS strings: theme-dark-v2.css alone
 * is 55 KB that profile-v3 never needs, and a <link> lets the browser cache and
 * parse each of them once. They are plain CSS (no Tailwind at-rules, and every
 * url() is a data URI), so a verbatim copy is faithful. Must stay in sync with
 * THEME_SHEETS in src/core/theme/theme-manager.ts and with
 * web_accessible_resources in both manifests.
 */
const THEME_CSS_FILES = [
  "theme-dark-v2.css",
  "theme-dark-v3.css",
  "theme-light-default-v3.css",
  "theme-light-v3.css",
];

/** The content script file that only the OAuth login flow uses. */
const AUTH_CALLBACK_SCRIPT = "auth-callback.js";

type ManifestContentScript = { matches?: string[]; js?: string[] };
type Manifest = {
  version?: string;
  host_permissions?: string[];
  content_scripts?: ManifestContentScript[];
  browser_specific_settings?: { gecko?: { id?: string; update_url?: string } };
  update_url?: string;
};

export type ManifestBuild = {
  target: "firefox" | "chrome";
  authMode: "oauth" | "intra";
  workerUrl: string;
  version: string;
  repo: { geckoId: string; updatesJsonUrl: string; updatesXmlUrl: string };
  chromeStore: boolean;
};

/**
 * The manifest template turned into the one a build ships. Pure, so that
 * tests/manifests.test.ts can check every mode without running a build.
 */
export function finalizeManifest(template: Manifest, build: ManifestBuild): Manifest {
  const manifest: Manifest = JSON.parse(JSON.stringify(template));
  manifest.version = build.version;
  // Self-hosted worker: rewrite the upstream origin in host permissions
  // and content script matches (package.json config.workerUrl).
  if (build.workerUrl !== DEFAULT_WORKER_URL) {
    const swap = (s: string) => s.replace(DEFAULT_WORKER_URL, build.workerUrl);
    manifest.host_permissions = (manifest.host_permissions ?? []).map(swap);
    for (const cs of manifest.content_scripts ?? []) {
      cs.matches = (cs.matches ?? []).map(swap);
    }
  }
  // In intra mode the login is a POST from the Intra page and the worker's
  // /callback page is never opened (account.ts only marks a pending OAuth
  // flow in the oauth branch), so a content script that reads credentials
  // out of that page's <script> text would only ever run for nothing.
  if (build.authMode === "intra") {
    manifest.content_scripts = (manifest.content_scripts ?? []).filter(
      (cs) => !(cs.js ?? []).includes(AUTH_CALLBACK_SCRIPT),
    );
  }
  if (build.target === "firefox") {
    // Firefox auto-update: id and update manifest derived from the
    // repository this fork lives in (package.json "repository").
    const gecko = (manifest.browser_specific_settings ??= {}).gecko ??= {};
    gecko.id = build.repo.geckoId;
    gecko.update_url = build.repo.updatesJsonUrl;
  } else if (!build.chromeStore) {
    // Chrome self-hosted updates (.crx + updates.xml). Ignored for
    // unpacked installs and on Windows/macOS, harmless there. The Chrome
    // Web Store build (CHROME_STORE=1) must not carry an update_url.
    manifest.update_url = build.repo.updatesXmlUrl;
  }
  return manifest;
}

export default defineConfig({
  plugins: [
    collapseLitTemplatesPlugin(),
    tailwindcss(),
    splitDaisyThemesPlugin(),
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

        const manifest = finalizeManifest(JSON.parse(fs.readFileSync(manifestSrc, "utf-8")), {
          target,
          authMode,
          workerUrl,
          version: pkg.version,
          repo,
          chromeStore: process.env.CHROME_STORE === "1",
        });
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
          "src/core/theme",
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
    // (there is no HTML entry to link it from). We want it on disk: out of
    // content.js, parsed once by the browser instead of once per shadow root,
    // and split in two by splitDaisyThemesPlugin() above.
    cssCodeSplit: false,
    rollupOptions: {
      input: { content: resolve(import.meta.dirname, "src/main.ts") },
      output: {
        format: "iife",
        entryFileNames: "[name].js",
        assetFileNames: (asset: { names?: string[]; name?: string }) => {
          const name = asset.names?.[0] ?? asset.name ?? "";
          // The one CSS asset of this build is src/core/styles/style.css compiled by
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
