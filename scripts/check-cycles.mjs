#!/usr/bin/env node
/**
 * Report import cycles between the modules of src/.
 *
 *   node scripts/check-cycles.mjs          # runtime (value) imports only
 *   node scripts/check-cycles.mjs --all    # also type-only imports
 *
 * Exits 1 when a runtime cycle exists. Type-only imports (`import type`,
 * `export type`, or a specifier list made only of `type X` names) are erased
 * by TypeScript and cannot create an initialisation-order problem, so they
 * are ignored by default.
 *
 * Why it matters here: the content script is a single bundle whose modules
 * run in dependency order. A cycle means one module can run while another it
 * depends on is still half-initialised, which shows up as `undefined` at
 * start-up only in some orders. The restructure of 1.11.0 removed the last
 * two; this keeps them out.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SRC = path.join(ROOT, "src");
const INCLUDE_TYPES = process.argv.includes("--all");

function listTs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(SRC, p).replace(/\\/g, "/");

/** Is this import/export statement erased by TypeScript? */
function isTypeOnly(statement) {
  if (/^\s*(import|export)\s+type\b/.test(statement)) return true;
  const braces = statement.match(/\{([^}]*)\}/);
  if (!braces) return false;
  // `import { type A, type B } from` with no default or namespace import
  if (/^\s*import\s+[\w$]+\s*,/.test(statement) || /\*\s+as\s+/.test(statement)) return false;
  const names = braces[1].split(",").map((s) => s.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => n.startsWith("type "));
}

function resolve(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\?.*$/, ""));
  for (const c of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile() && c.endsWith(".ts")) return c;
  }
  return null;
}

const graph = new Map();
for (const file of listTs(SRC)) {
  const text = fs.readFileSync(file, "utf8");
  const edges = new Set();
  // whole statements, possibly multi-line, up to the module specifier
  const re = /(?:^|\n)\s*((?:import|export)\b[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["'])|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|(?:^|\n)\s*import\s*["'](\.{1,2}\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(text))) {
    const spec = m[2] || m[3] || m[4];
    if (m[1] && !INCLUDE_TYPES && isTypeOnly(m[1])) continue;
    // dynamic import() never runs during initialisation: not an init cycle
    if (m[3]) continue;
    const target = resolve(file, spec);
    if (target) edges.add(target);
  }
  graph.set(file, edges);
}

// Tarjan's strongly connected components: every component of more than one
// module (or a module importing itself) is a cycle.
let index = 0;
const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], groups = [];
function strong(v) {
  idx.set(v, index);
  low.set(v, index++);
  stack.push(v);
  onStack.add(v);
  for (const w of graph.get(v) ?? []) {
    if (!idx.has(w)) {
      strong(w);
      low.set(v, Math.min(low.get(v), low.get(w)));
    } else if (onStack.has(w)) {
      low.set(v, Math.min(low.get(v), idx.get(w)));
    }
  }
  if (low.get(v) === idx.get(v)) {
    const group = [];
    let w;
    do {
      w = stack.pop();
      onStack.delete(w);
      group.push(w);
    } while (w !== v);
    if (group.length > 1 || graph.get(v)?.has(v)) groups.push(group);
  }
}
for (const v of graph.keys()) if (!idx.has(v)) strong(v);

const kind = INCLUDE_TYPES ? "import (including type-only)" : "runtime import";
if (groups.length === 0) {
  console.log(`${graph.size} modules, 0 ${kind} cycles.`);
  process.exit(0);
}
console.log(`${graph.size} modules, ${groups.length} ${kind} cycle group(s):`);
for (const g of groups) console.log("  " + g.map(rel).sort().join("  <->  "));
process.exit(INCLUDE_TYPES ? 0 : 1);
