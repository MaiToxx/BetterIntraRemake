/**
 * The French catalog against the code: every text the code translates has a
 * French entry, with the same {placeholders}, and the catalog holds nothing
 * the code no longer uses.
 *
 * "The code translates" means: the string literal given to t(), tp() or
 * msg() (imported from src/core/i18n/i18n.ts) in any file of src/, and the
 * label, description and option labels of every hub setting (the hub
 * renders them through t()). A non-literal first argument to tp() or msg()
 * is an error: the build keeps a translation in a bundle only when that
 * bundle contains its English text as a literal (scripts/i18n-catalog.ts).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";
import { loadCatalog } from "../scripts/i18n-catalog.ts";
import { HUB_SETTING_DEFS } from "../src/features/hub/hubSettings.data.ts";

type Node = { type?: string; start?: number; end?: number; [k: string]: unknown };

const SRC = path.resolve(__dirname, "../src");
const I18N_MODULE = path.join(SRC, "core/i18n/i18n");

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [full] : [];
  });
}

function walk(node: unknown, visit: (n: Node) => void): void {
  const stack: unknown[] = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      for (const c of n) stack.push(c);
      continue;
    }
    visit(n as Node);
    for (const k in n as Node) {
      if (k === "type" || k === "start" || k === "end") continue;
      const c = (n as Node)[k];
      if (c && typeof c === "object") stack.push(c);
    }
  }
}

/** A string the argument certainly is, or null for a dynamic one. */
function literalStrings(arg: Node | undefined): string[] | null {
  if (!arg) return null;
  if (arg.type === "Literal" && typeof arg.value === "string") return [arg.value];
  if (arg.type === "TemplateLiteral" && (arg.expressions as unknown[]).length === 0) {
    const q = (arg.quasis as Node[])[0];
    return [String((q.value as { cooked: string }).cooked)];
  }
  if (arg.type === "ConditionalExpression") {
    const a = literalStrings(arg.consequent as Node);
    const b = literalStrings(arg.alternate as Node);
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

interface Use {
  key: string;
  where: string;
}

function collectFromCode(): { uses: Use[]; errors: string[] } {
  const uses: Use[] = [];
  const errors: string[] = [];
  for (const file of tsFiles(SRC)) {
    const code = fs.readFileSync(file, "utf8");
    if (!code.includes("i18n")) continue;
    const program = parseAst(code, { lang: "ts" }) as unknown as Node;
    // the local names t / tp / msg are imported under
    const names = new Map<string, "t" | "tp" | "msg">();
    walk(program, (n) => {
      if (n.type !== "ImportDeclaration") return;
      const source = String((n.source as Node).value);
      // resolved against the importing file: "../i18n/i18n.ts" from core/intra
      // is the same module as "../../core/i18n/i18n.ts" from a feature
      if (!source.startsWith(".")) return;
      if (path.resolve(path.dirname(file), source).replace(/\.ts$/, "") !== I18N_MODULE) return;
      for (const s of n.specifiers as Node[]) {
        if (s.type !== "ImportSpecifier") continue;
        const imported = String((s.imported as Node).name ?? (s.imported as Node).value);
        if (imported === "t" || imported === "tp" || imported === "msg") {
          names.set(String((s.local as Node).name), imported);
        }
      }
    });
    if (!names.size) continue;
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    walk(program, (n) => {
      if (n.type !== "CallExpression") return;
      const callee = n.callee as Node;
      if (callee.type !== "Identifier") return;
      const fn = names.get(String(callee.name));
      if (!fn) return;
      const args = n.arguments as Node[];
      const line = code.slice(0, Number(n.start)).split("\n").length;
      const where = `${rel}:${line}`;
      const need = fn === "tp" ? [args[1], args[2]] : [args[0]];
      for (const arg of need) {
        const strings = literalStrings(arg);
        if (strings) for (const key of strings) uses.push({ key, where });
        // t(def.label), t(CONSTANT): the text comes from a def or a msg()
        else if (fn !== "t") errors.push(`${where}: ${fn}() needs a string literal`);
      }
    });
  }
  return { uses, errors };
}

/**
 * Option labels that stay as written in every language: the languages
 * themselves, and names (themes, fonts, palettes) that are not words.
 */
const UNTRANSLATED_OPTION_KINDS = new Set(["theme-preset"]);
const UNTRANSLATED_LABELS = new Set(["Français", "English"]);

function collectFromDefs(): Use[] {
  const uses: Use[] = [];
  for (const [tab, defs] of Object.entries(HUB_SETTING_DEFS)) {
    for (const def of defs) {
      const where = `hub ${tab}: ${def.key ?? def.kind}`;
      const d = def as unknown as {
        label?: string;
        desc?: string;
        kind: string;
        options?: { label?: string; desc?: string; subToggle?: { label?: string; desc?: string } }[];
        translateOptions?: boolean;
      };
      if (d.label) uses.push({ key: d.label, where });
      if (d.desc) uses.push({ key: d.desc, where });
      if (UNTRANSLATED_OPTION_KINDS.has(d.kind) || d.translateOptions === false) continue;
      for (const o of d.options ?? []) {
        if (o.label && !UNTRANSLATED_LABELS.has(o.label)) uses.push({ key: o.label, where });
        if (o.desc) uses.push({ key: o.desc, where });
        if (o.subToggle?.label) uses.push({ key: o.subToggle.label, where });
        if (o.subToggle?.desc) uses.push({ key: o.subToggle.desc, where });
      }
    }
  }
  return uses;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the French catalog", () => {
  const catalog = loadCatalog();
  const code = collectFromCode();
  const uses = [...code.uses, ...collectFromDefs()];
  const used = new Set(uses.map((u) => u.key));

  it("t(), tp() and msg() are called the way the build can see", () => {
    expect(code.errors).toEqual([]);
  });

  it("every translated text has a French entry", () => {
    const missing = [...new Map(uses.filter((u) => !(u.key in catalog)).map((u) => [u.key, u.where])).entries()]
      .map(([key, where]) => `${where}  ${JSON.stringify(key)}`)
      .sort();
    expect(missing).toEqual([]);
  });

  it("keeps every {placeholder}, and adds none", () => {
    const wrong = Object.entries(catalog)
      .filter(([en, fr]) => placeholders(en).join() !== placeholders(fr).join())
      .map(([en, fr]) => `${en} → ${fr}`);
    expect(wrong).toEqual([]);
  });

  it("holds no entry the code does not use", () => {
    expect(Object.keys(catalog).filter((k) => !used.has(k)).sort()).toEqual([]);
  });

  it("French keeps the text's outer shape (spaces at the ends, final punctuation kind)", () => {
    const wrong = Object.entries(catalog).filter(([en, fr]) => {
      if (/^\s/.test(en) !== /^\s/.test(fr) || /\s$/.test(en) !== /\s$/.test(fr)) return true;
      return false;
    });
    expect(wrong.map(([en]) => en)).toEqual([]);
  });
});
