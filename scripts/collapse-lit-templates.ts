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
 * So do its HTML comments (notes for the reader, never rendered: 1.2 KB of
 * content.js after 1.17.1), except the `<!--!` ones, the convention for a
 * comment that must stay (a licence notice).
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

/**
 * An HTML comment, not a `<!--!` one. Removed with nothing in its place: a
 * comment between two words does not separate them on screen either.
 */
const HTML_COMMENT = /<!--(?!!)[\s\S]*?-->/g;
const ANY_HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Whether every HTML comment of the template opens and closes in the same
 * quasi. A comment cut by a ${} leaves the next quasi starting inside it,
 * where a `<!--` of its text would be taken for a new comment: such a
 * template keeps all its comments.
 */
function commentsWithinQuasis(code: string, quasis: [number, number][]): boolean {
  return quasis.every(([start, end]) => {
    const rest = code.slice(start, end).replace(ANY_HTML_COMMENT, "");
    return !rest.includes("<!--") && !rest.includes("-->");
  });
}

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
 * `raw` without the comments of the <style> it is in or opens and, with
 * `html`, without the HTML comments outside it; `inStyle` says whether it
 * starts inside one (a <style> spans several quasis when it holds a ${}).
 */
function stripComments(raw: string, inStyle: boolean, html: boolean): [string, boolean] {
  const strip = (part: string, style: boolean) =>
    style ? part.replace(CSS_COMMENT, " ") : html ? part.replace(HTML_COMMENT, "") : part;
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(STYLE_TAG)) {
    out += strip(raw.slice(last, m.index), inStyle) + m[0];
    last = m.index + m[0].length;
    inStyle = m[1] === "";
  }
  return [out + strip(raw.slice(last), inStyle), inStyle];
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
    const htmlComments = kind === "html" && commentsWithinQuasis(code, quasis);
    for (const [start, end] of quasis) {
      // The parser gives the quasi's raw text span (between ` or } and ${ or `).
      const raw = code.slice(start, end);
      let text = raw;
      if (kind === "css") text = raw.replace(CSS_COMMENT, " ");
      else [text, inStyle] = stripComments(raw, inStyle, htmlComments);
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
