/**
 * Build-time whitespace collapse for lit `html` templates.
 *
 * The templates are written indented for reading, and every indent ships in
 * content.js as string bytes: about 40 KB of the bundle was newlines and
 * spaces inside html`` literals. lit-html parses each template once and
 * whitespace-only text between tags never renders, so collapsing every run of
 * whitespace that contains a newline into one space changes nothing on screen
 * (inline text keeps its single separating space).
 *
 * Only the string parts (quasis) of templates tagged exactly `html` are
 * touched: CSS strings, ICS bodies and toast texts are untagged and stay
 * byte-identical. A template that contains <pre or white-space is left alone,
 * because there the whitespace is content.
 */
import MagicString from "magic-string";
import { parseAst } from "rolldown/parseAst";
import type { Plugin } from "vite";

type Node = { type?: string; start?: number; end?: number; [k: string]: unknown };

const SKIP = /<pre\b|white-space|<textarea\b/i;

/** Every `html`-tagged template in `code`, as [start, end] of each quasi. */
function quasiRanges(code: string, file: string): [number, number][] {
  const out: [number, number][] = [];
  const program = parseAst(code, {
    lang: file.endsWith(".ts") ? "ts" : "js",
  }) as unknown as Node;
  const visit = (node: Node | null | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n as Node);
      return;
    }
    if (
      node.type === "TaggedTemplateExpression" &&
      (node.tag as Node)?.type === "Identifier" &&
      (node.tag as { name?: string }).name === "html"
    ) {
      const quasi = node.quasi as { quasis: Node[]; start: number; end: number };
      if (!SKIP.test(code.slice(quasi.start, quasi.end))) {
        for (const q of quasi.quasis) out.push([q.start!, q.end!]);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      visit(node[key] as Node);
    }
  };
  visit(program);
  return out;
}

/** The collapsed source, or null when nothing changed. */
export function collapseLitTemplates(code: string, file: string): string | null {
  if (!code.includes("html`")) return null;
  const s = new MagicString(code);
  let changed = false;
  for (const [start, end] of quasiRanges(code, file)) {
    // The parser gives the quasi's raw text span (between ` or } and ${ or `).
    const raw = code.slice(start, end);
    const collapsed = raw.replace(/[ \t]*\n[ \t\n]*/g, " ");
    if (collapsed !== raw) {
      s.overwrite(start, end, collapsed);
      changed = true;
    }
  }
  return changed ? s.toString() : null;
}

export function collapseLitTemplatesPlugin(): Plugin {
  return {
    name: "collapse-lit-templates",
    enforce: "pre",
    transform(code, id) {
      if (!/\.ts$/.test(id) || id.includes("node_modules")) return null;
      const out = collapseLitTemplates(code, id);
      return out === null ? null : { code: out, map: null };
    },
  };
}
