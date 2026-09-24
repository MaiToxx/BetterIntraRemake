/**
 * Build-time whitespace collapse for lit `html` templates and `css` blocks.
 *
 * The templates are written indented for reading, and every indent ships in
 * content.js as string bytes: about 40 KB of the bundle was newlines and
 * spaces inside html`` literals. lit-html parses each template once and
 * whitespace-only text between tags never renders, so collapsing every run of
 * whitespace that contains a newline into one space changes nothing on screen
 * (inline text keeps its single separating space). The CSS comments of a
 * template's <style> go too: they explain the code, the browser skips them.
 *
 * Only the string parts (quasis) of templates tagged exactly `html` or `css`
 * are touched: ICS bodies, toast texts and other untagged literals stay
 * byte-identical. A `css` block (src/core/dom/css.ts) loses its comments and
 * indentation, and its tag, so that it ships as the plain literal it would
 * have been. An html template that contains <pre, <textarea or a white-space
 * value that keeps newlines (pre, pre-wrap, pre-line, break-spaces, as a
 * declaration or a Tailwind class) is left alone, because there the
 * whitespace is content. `white-space: nowrap` or `normal` collapses runs
 * like the default: skipping on the bare word kept the whole cluster map
 * dialog (its <style> says nowrap) indented, about 6 KB of content.js.
 */
import MagicString from "magic-string";
import { parseAst } from "rolldown/parseAst";
import type { Plugin } from "vite";

type Node = { type?: string; start?: number; end?: number; [k: string]: unknown };

const SKIP = /<pre\b|<textarea\b|white-space\s*:\s*(pre|break-spaces)|\bwhitespace-(pre|break-spaces)/i;

/**
 * A CSS comment and the whitespace around it, replaced by one space: a
 * comment separates tokens (`0/**\/auto` is two values), and the space keeps
 * them apart. A comment cut by a ${} is two quasis and is left as written.
 */
const CSS_COMMENT = /\s*\/\*[\s\S]*?\*\/\s*/g;
const STYLE_TAG = /<(\/?)style\b/gi;

/** \r too: in a CRLF file the run used to stop at the \r, and every line
 * still shipped a newline (the minifier writes \r\n as \n). */
const collapse = (raw: string) => raw.replace(/[ \t\r]*\n[ \t\r\n]*/g, " ");

interface Template {
  kind: "html" | "css";
  /** The tag identifier, [start, end]. */
  tag: [number, number];
  /** [start, end] of each quasi, in source order. */
  quasis: [number, number][];
}

/** Every `html`- or `css`-tagged template in `code`. */
function taggedTemplates(code: string, file: string): Template[] {
  const out: Template[] = [];
  const program = parseAst(code, {
    lang: file.endsWith(".ts") ? "ts" : "js",
  }) as unknown as Node;
  const visit = (node: Node | null | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n as Node);
      return;
    }
    const tag = node.tag as Node | undefined;
    const name = (tag as { name?: string } | undefined)?.name;
    if (
      node.type === "TaggedTemplateExpression" &&
      tag?.type === "Identifier" &&
      (name === "html" || name === "css")
    ) {
      const quasi = node.quasi as { quasis: Node[]; start: number; end: number };
      if (name === "css" || !SKIP.test(code.slice(quasi.start, quasi.end))) {
        out.push({
          kind: name,
          tag: [tag.start!, tag.end!],
          quasis: quasi.quasis.map((q) => [q.start!, q.end!]),
        });
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

/**
 * `raw` without the comments of the <style> it is in or opens; `inStyle`
 * says whether it starts inside one (a <style> spans several quasis when it
 * holds a ${}).
 */
function stripStyleComments(raw: string, inStyle: boolean): [string, boolean] {
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(STYLE_TAG)) {
    const part = raw.slice(last, m.index);
    out += (inStyle ? part.replace(CSS_COMMENT, " ") : part) + m[0];
    last = m.index + m[0].length;
    inStyle = m[1] === "";
  }
  const rest = raw.slice(last);
  return [out + (inStyle ? rest.replace(CSS_COMMENT, " ") : rest), inStyle];
}

/** The collapsed source, or null when nothing changed. */
export function collapseLitTemplates(code: string, file: string): string | null {
  if (!code.includes("html`") && !code.includes("css`")) return null;
  const s = new MagicString(code);
  let changed = false;
  for (const { kind, tag, quasis } of taggedTemplates(code, file)) {
    if (kind === "css") {
      // a plain literal again: the import of css is then unused and dropped
      s.remove(tag[0], tag[1]);
      changed = true;
    }
    let inStyle = false;
    for (const [start, end] of quasis) {
      // The parser gives the quasi's raw text span (between ` or } and ${ or `).
      const raw = code.slice(start, end);
      let text = raw;
      if (kind === "css") text = raw.replace(CSS_COMMENT, " ");
      else [text, inStyle] = stripStyleComments(raw, inStyle);
      text = collapse(text);
      if (text !== raw) {
        s.overwrite(start, end, text);
        changed = true;
      }
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
