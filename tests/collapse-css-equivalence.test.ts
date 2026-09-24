/**
 * The build collapses the style text of every css`` block and of every
 * <style> in an html`` template (scripts/collapse-lit-templates.ts): no
 * comments, no indentation. This walks src/ and checks, block by block, that
 * the browser's CSS parser (jsdom's) reads the shipped text as the same
 * rules as the source text. A comment glued to a token, or a collapse inside
 * a value, would show up here instead of on a student's profile.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";
import { collapseLitTemplates } from "../scripts/collapse-lit-templates";

type Node = { type?: string; start?: number; end?: number; [k: string]: unknown };

const SRC = path.resolve(__dirname, "../src");

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [full] : [];
  });
}

/** Each tagged template of `code` (tag html or css): its tag, and its quasis' raw text. */
function templates(code: string): { tag: string; start: number; end: number; quasis: string[] }[] {
  const out: { tag: string; start: number; end: number; quasis: string[] }[] = [];
  const stack: unknown[] = [parseAst(code, { lang: "ts" })];
  while (stack.length) {
    const n = stack.pop() as Node | Node[] | null;
    if (!n || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      stack.push(...n);
      continue;
    }
    const tag = n.tag as Node | undefined;
    if (n.type === "TaggedTemplateExpression" && tag?.type === "Identifier") {
      const name = String(tag.name);
      const quasi = n.quasi as { quasis: Node[] };
      if (name === "html" || name === "css") {
        out.push({
          tag: name,
          start: n.start!,
          end: n.end!,
          quasis: quasi.quasis.map((q) => code.slice(q.start!, q.end!)),
        });
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end") continue;
      const c = n[k];
      if (c && typeof c === "object") stack.push(c);
    }
  }
  return out;
}

/** The quasis of the one template literal in `code` (tagged or not). */
function onlyTemplateQuasis(code: string): string[] {
  const stack: unknown[] = [parseAst(code, { lang: "ts" })];
  while (stack.length) {
    const n = stack.pop() as Node | Node[] | null;
    if (!n || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      stack.push(...n);
      continue;
    }
    if (n.type === "TemplateLiteral") {
      return (n.quasis as Node[]).map((q) => code.slice(q.start!, q.end!));
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end") continue;
      const c = n[k];
      if (c && typeof c === "object") stack.push(c);
    }
  }
  throw new Error("no template literal");
}

/**
 * The text with every ${} as the same neutral token on both sides. The
 * parser's quasi spans hold their delimiters (` or } before, ${ or ` after).
 */
const join = (quasis: string[]) =>
  quasis
    .map((q, i) => (i ? `x${i}` : "") + q.replace(/^[`}]/, "").replace(/(\$\{|`)$/, "").replace(/\r/g, ""))
    .join("");

/** The style text of a template: all of a css block, the <style> contents of an html one. */
function styleText(tag: string, text: string): string[] {
  if (tag === "css") return [text];
  return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
}

/**
 * The rules as the parser serialises them. It keeps the line breaks of a
 * selector list or a value as written: runs of whitespace count as one.
 */
function rules(cssText: string): string[] {
  const style = document.createElement("style");
  style.textContent = cssText;
  document.head.appendChild(style);
  const out = [...style.sheet!.cssRules].map((r) => r.cssText.replace(/\s+/g, " "));
  style.remove();
  return out;
}

describe("collapsed style text parses as the source text", () => {
  const blocks: { where: string; before: string; after: string }[] = [];
  for (const file of tsFiles(SRC)) {
    const code = fs.readFileSync(file, "utf8");
    if (!code.includes("css`") && !code.includes("<style")) continue;
    for (const t of templates(code)) {
      const source = code.slice(t.start, t.end);
      const built = collapseLitTemplates(`const a = ${source};`, "x.ts");
      const after = built === null ? t.quasis : onlyTemplateQuasis(built);
      const beforeStyles = styleText(t.tag, join(t.quasis));
      const afterStyles = styleText(t.tag, join(after));
      const where = `${path.relative(SRC, file).replace(/\\/g, "/")}:${code.slice(0, t.start).split("\n").length}`;
      expect(afterStyles.length, where).toBe(beforeStyles.length);
      beforeStyles.forEach((before, i) => {
        // <style>${STYLE}</style>: the rules are a css block of their own
        if (before.includes("{")) blocks.push({ where, before, after: afterStyles[i] });
      });
    }
  }

  it("finds the style blocks (the css blocks and the templates' <style>)", () => {
    expect(blocks.length).toBeGreaterThan(8);
    // the build did shrink them
    const saved = blocks.reduce((n, b) => n + b.before.length - b.after.length, 0);
    expect(saved).toBeGreaterThan(2000);
  });

  it("every block gives the same rules once collapsed", () => {
    for (const { where, before, after } of blocks) {
      const expected = rules(before);
      expect(expected.length, `${where}: the source parses to rules`).toBeGreaterThan(0);
      expect(rules(after), where).toEqual(expected);
    }
  });
});
