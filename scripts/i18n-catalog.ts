/**
 * The French catalog, for the builds and the tests.
 *
 * src/core/i18n/fr/*.json map English text (the key t() is called with) to
 * French, one file per area of the extension. They are merged here; the same
 * English text translated two ways is an error.
 *
 * `virtual:bi-fr-catalog` (imported by src/core/i18n/i18n.ts) is that merged
 * catalog. In a build it is filtered per bundle: renderChunk parses the
 * chunk, collects every string it contains, and keeps only the entries whose
 * English text is among them. content.js, popup.js and background.js each
 * carry the translations of their own text, not the whole catalog (the popup
 * has a tight size budget). This works because t() / tp() / msg() are only
 * ever called with string literals (tests/i18n-catalog.test.ts).
 *
 * Tests (vitest.config.ts) get the whole catalog: no renderChunk there.
 */
import fs from "node:fs";
import { resolve } from "node:path";
import { parseAst } from "rolldown/parseAst";
import type { Plugin } from "vite";

export const CATALOG_DIR = resolve(import.meta.dirname, "../src/core/i18n/fr");
const VIRTUAL_ID = "virtual:bi-fr-catalog";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
/** Stands for the catalog until the chunk's strings are known. */
const PLACEHOLDER = "__BI_FR_CATALOG__";

/** Every catalog file merged; throws on a key translated two ways. */
export function loadCatalog(dir: string = CATALOG_DIR): Record<string, string> {
  const merged: Record<string, string> = {};
  const origin: Record<string, string> = {};
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    : [];
  for (const file of files) {
    const entries = JSON.parse(fs.readFileSync(resolve(dir, file), "utf8")) as Record<string, unknown>;
    for (const [english, french] of Object.entries(entries)) {
      if (typeof french !== "string" || !french) {
        throw new Error(`${file}: the translation of "${english}" is not a text`);
      }
      if (english in merged && merged[english] !== french) {
        throw new Error(`"${english}" is translated differently in ${origin[english]} and ${file}`);
      }
      merged[english] = french;
      origin[english] = file;
    }
  }
  return merged;
}

type Node = { type?: string; [k: string]: unknown };

/** Every string a piece of JavaScript holds: literals and template parts. */
export function stringsIn(code: string): Set<string> {
  const found = new Set<string>();
  const program = parseAst(code, { lang: "js" }) as unknown as Node;
  const stack: unknown[] = [program];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const n of node) stack.push(n);
      continue;
    }
    const n = node as Node;
    if (n.type === "Literal" && typeof n.value === "string") found.add(n.value);
    if (n.type === "TemplateElement") {
      const cooked = (n.value as { cooked?: string | null } | undefined)?.cooked;
      if (typeof cooked === "string") found.add(cooked);
    }
    for (const key in n) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = n[key];
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return found;
}

/** The catalog entries whose English text appears in `code`. */
export function subsetFor(code: string, catalog: Record<string, string>): Record<string, string> {
  const strings = stringsIn(code);
  const out: Record<string, string> = {};
  for (const [english, french] of Object.entries(catalog)) {
    if (strings.has(english)) out[english] = french;
  }
  return out;
}

/** Replaces the placeholder literal, whatever quotes the code uses for it. */
export function injectCatalog(code: string, subset: Record<string, string>): string {
  const literal = JSON.stringify(JSON.stringify(subset));
  return code.replace(new RegExp(`(["'\`])${PLACEHOLDER}\\1`, "g"), () => literal);
}

/** `filter: false` (tests): the whole catalog, nothing to cut. */
export function frCatalogPlugin(opts: { filter?: boolean } = {}): Plugin {
  const filter = opts.filter ?? true;
  return {
    name: "bi-fr-catalog",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      if (fs.existsSync(CATALOG_DIR)) {
        for (const file of fs.readdirSync(CATALOG_DIR)) this.addWatchFile(resolve(CATALOG_DIR, file));
      }
      if (!filter) return `export default ${JSON.stringify(loadCatalog())};`;
      return `export default JSON.parse(${JSON.stringify(PLACEHOLDER)});`;
    },
    renderChunk(code) {
      if (!filter || !code.includes(PLACEHOLDER)) return null;
      return { code: injectCatalog(code, subsetFor(code, loadCatalog())), map: null };
    },
  };
}
