/**
 * @vitest-environment node
 *
 * The split content script, checked on a real build (docs/CODE-SPLITTING.md):
 * vite.config.ts (content-main.js + chunks/) and vite.loader.config.ts
 * (content.js) are built for both targets into a temporary folder, the way
 * package.json does it, and the output is held to the rules that keep one
 * instance of every stateful module and keep Vite's preload helper off the
 * Intra page.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "vite";

const ROOT = path.resolve(__dirname, "..");
const INTRA = "https://*.intra.42.fr/*";

type Chunk = {
  type: "chunk";
  fileName: string;
  code: string;
  isEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  moduleIds: string[];
};
type Output = { output: (Chunk | { type: "asset"; fileName: string })[] };

interface Built {
  dir: string;
  /** The chunks of the content build (content-main.js and chunks/). */
  chunks: Chunk[];
  /** The loader build's one chunk (content.js). */
  loader: Chunk;
}

async function buildTarget(target: "firefox" | "chrome"): Promise<Built> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `better-intra-split-${target}-`));
  const saved = { TARGET: process.env.TARGET, BUILD_OUT_DIR: process.env.BUILD_OUT_DIR };
  // The configs read these when they are loaded, as with cross-env in package.json.
  process.env.TARGET = target;
  process.env.BUILD_OUT_DIR = dir;
  try {
    const chunksOf = (result: unknown): Chunk[] =>
      (Array.isArray(result) ? result : [result]).flatMap((o: Output) =>
        o.output.filter((f): f is Chunk => f.type === "chunk"),
      );
    const main = chunksOf(
      await build({ root: ROOT, configFile: path.join(ROOT, "vite.config.ts"), logLevel: "silent" }),
    );
    const [loader] = chunksOf(
      await build({ root: ROOT, configFile: path.join(ROOT, "vite.loader.config.ts"), logLevel: "silent" }),
    );
    return { dir, chunks: main, loader };
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Every file under `dir`, as posix paths relative to it. */
function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

/** A web_accessible_resources pattern: `*` matches anything, "/" included. */
const globMatches = (glob: string, file: string) =>
  new RegExp(`^${glob.split("*").map((s) => s.split(".").join("[.]")).join(".*")}$`).test(file);

const rel = (id: string) => path.relative(ROOT, id).split(path.sep).join("/");

const builds: Partial<Record<"firefox" | "chrome", Built>> = {};

beforeAll(async () => {
  builds.firefox = await buildTarget("firefox");
  builds.chrome = await buildTarget("chrome");
}, 120_000);

afterAll(() => {
  for (const b of Object.values(builds)) {
    if (b) fs.rmSync(b.dir, { recursive: true, force: true });
  }
});

describe.each(["firefox", "chrome"] as const)("split build (%s)", (target) => {
  const b = () => builds[target]!;
  const entry = () => b().chunks.find((c) => c.isEntry)!;
  const read = (file: string) => fs.readFileSync(path.join(b().dir, file), "utf8");

  it("content.js is the loader: a few KB, no storage, one URL for the app", () => {
    const code = read("content.js");
    expect(Buffer.byteLength(code)).toBeLessThan(4 * 1024);
    expect(code).not.toContain("chrome.storage");
    expect(code).not.toContain("setItem");
    // A classic script (IIFE) that imports the app dynamically, by one name.
    expect(code).not.toMatch(/(^|[;}])\s*(import\s*[{*]|export\s*[{*])/);
    // import(chrome.runtime.getURL("content-main.js")), the call inline
    // (addons-linter flags an import() of a variable), and nothing appended.
    expect(code).toMatch(/import\(chrome\.runtime\.getURL\((["'`])content-main\.js\1\)\)/);
    expect(code.split("content-main.js")).toHaveLength(2);
    // Nothing but the loader and constant modules (and the preload stub).
    const modules = b().loader.moduleIds.filter((id) => !id.startsWith("\0"));
    expect(modules.map(rel).sort()).toEqual(["src/core/intra/selectors.ts", "src/loader.ts"]);
  });

  it("the manifest keeps one classic content script and exposes the app and its chunks", () => {
    const manifest = JSON.parse(read("manifest.json"));
    const onIntra = manifest.content_scripts.filter((cs: { matches: string[] }) =>
      cs.matches.includes(INTRA),
    );
    expect(onIntra).toEqual([{ matches: [INTRA], js: ["content.js"], run_at: "document_start" }]);

    const war = manifest.web_accessible_resources.find((w: { matches: string[] }) =>
      w.matches.includes(INTRA),
    );
    expect(war.resources).toEqual(expect.arrayContaining(["content-main.js", "chunks/*.js"]));
    const exposed = (file: string) => war.resources.some((g: string) => globMatches(g, file));
    const js = walk(b().dir).filter((f) => f.endsWith(".js") && f !== "content.js");
    expect(js).toContain("content-main.js");
    expect(js.some((f) => f.startsWith("chunks/"))).toBe(true);
    for (const file of js) expect(exposed(file), file).toBe(true);
  });

  it("no output file mentions modulepreload, nor Vite's preload error event", () => {
    for (const file of walk(b().dir)) {
      if (!/\.(js|css|json|html)$/.test(file)) continue;
      const text = read(file);
      expect(text.includes("modulepreload"), file).toBe(false);
      expect(text.includes("vite:preloadError"), file).toBe(false);
    }
  });

  it("one eager file, hashed chunk names, and every chunk bound to ../content-main.js", () => {
    expect(entry().fileName).toBe("content-main.js");
    // The $initial group: nothing the entry imports statically is split off.
    expect(entry().imports).toEqual([]);
    const files = new Set(b().chunks.map((c) => c.fileName));
    for (const c of b().chunks) {
      if (c.isEntry) continue;
      expect(c.fileName).toMatch(/^chunks\/[\w.-]+-[\w-]{8}\.js$/);
      const specifiers = [...c.code.matchAll(/\bfrom\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
      for (const s of specifiers) {
        expect(s === "../content-main.js" || files.has(path.posix.join("chunks", s)), `${c.fileName}: ${s}`).toBe(true);
      }
    }
    // The entry imports its chunks relative to itself, and they exist.
    const lazy = [...entry().code.matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]);
    expect(lazy.length).toBeGreaterThan(0);
    for (const s of lazy) expect(files.has(path.posix.normalize(s)), s).toBe(true);
  });

  it("every module is in exactly one chunk, and the stateful core is in the entry", () => {
    const seen = new Map<string, string>();
    for (const c of b().chunks) {
      for (const id of c.moduleIds) {
        expect(seen.get(id), `${rel(id)} in ${c.fileName} and ${seen.get(id)}`).toBeUndefined();
        seen.set(id, c.fileName);
      }
    }
    const inEntry = new Set(entry().moduleIds.map(rel));
    for (const file of [
      "src/main.ts",
      "src/core/config.ts",
      "src/core/config/snapshot.ts",
      "src/core/theme/theme-manager.ts",
      "src/core/styles/shared-styles.ts",
      "src/features/customize/customize.ts",
      "src/features/clusters/open-map.ts",
      "src/features/eggs/eggs.ts",
      "src/features/profile/extras/extras-apply.ts",
    ]) {
      expect(inEntry.has(file), file).toBe(true);
    }
  });

  it("each lazy boundary is a chunk of its own, out of the entry", () => {
    const chunkOf = (file: string) =>
      b().chunks.find((c) => c.moduleIds.some((id) => rel(id) === file));
    const inEntry = new Set(entry().moduleIds.map(rel));
    for (const file of [
      "src/features/hub/hubSettings.ui.ts",
      "src/features/clusters/map-dialog.ts",
      "src/features/profile/header/profile.modal.ts",
      "src/features/profile/extras/extras-effects.ts",
      "src/features/eggs/eggs-effects.ts",
      "src/features/calendar/qr.ts",
      "src/features/customize/presets.ts",
    ]) {
      expect(inEntry.has(file), file).toBe(false);
      const chunk = chunkOf(file);
      expect(chunk?.fileName, file).toMatch(/^chunks\//);
    }
    expect(entry().moduleIds.some((id) => id.includes("qrcode-generator"))).toBe(false);
    // Loaded by an import() of the entry (qr.ts by the hub's chunk).
    const hub = chunkOf("src/features/hub/hubSettings.ui.ts")!;
    expect(entry().dynamicImports).toEqual(
      expect.arrayContaining(
        [
          "src/features/clusters/map-dialog.ts",
          "src/features/profile/header/profile.modal.ts",
          "src/features/profile/extras/extras-effects.ts",
          "src/features/eggs/eggs-effects.ts",
          "src/features/hub/hubSettings.ui.ts",
        ].map((f) => chunkOf(f)!.fileName),
      ),
    );
    expect(hub.dynamicImports).toContain(chunkOf("src/features/calendar/qr.ts")!.fileName);
  });
});

describe("source manifests", () => {
  it.each(["chrome", "firefox"])("manifest.%s.json exposes content-main.js and chunks/*.js to the Intra", (target) => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "manifests", `manifest.${target}.json`), "utf8"),
    );
    const war = manifest.web_accessible_resources.find((w: { matches: string[] }) =>
      w.matches.includes(INTRA),
    );
    expect(war.resources).toEqual(expect.arrayContaining(["content-main.js", "chunks/*.js"]));
    expect(war.use_dynamic_url).toBeUndefined();
  });
});
