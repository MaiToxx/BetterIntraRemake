#!/usr/bin/env node
/**
 * Move source modules and rewrite every relative import that points at them.
 *
 *   node scripts/move-modules.mjs plan.json            # dry run: print the rewrites
 *   node scripts/move-modules.mjs plan.json --apply    # git mv + rewrite imports
 *
 * plan.json is an array of [from, to] pairs relative to the repository root,
 * e.g. [["src/features/profile/theme", "src/core/theme"]]. A pair may name a
 * folder (moved as a whole) or a single file.
 *
 * Why a script: a reorganisation touches hundreds of import specifiers. Doing
 * it by hand, or with several people editing at once, is how an import ends
 * up pointing at the old place. This tool resolves every relative specifier
 * against the file's ORIGINAL location, maps both ends through the plan, and
 * writes the new relative path from the file's NEW location, so the result
 * is correct by construction. `git mv` keeps each file's history.
 *
 * It understands static imports and re-exports, side-effect imports,
 * dynamic import(), and vi.mock()/vi.importActual() in tests. It keeps the
 * specifier's style: with or without the ".ts" extension, and any Vite query
 * suffix such as "?raw" or "?inline".
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SCAN_DIRS = ["src", "tests"];
const SOURCE_EXT = /\.(ts|mts|js|mjs)$/;

const [planFile, flag] = process.argv.slice(2);
if (!planFile) {
  console.error("usage: node scripts/move-modules.mjs plan.json [--apply]");
  process.exit(2);
}
const APPLY = flag === "--apply";
const plan = JSON.parse(fs.readFileSync(path.resolve(planFile), "utf8"));

const abs = (p) => path.resolve(ROOT, p);
const norm = (p) => p.replace(/\\/g, "/");

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. Expand the plan into an exact old path -> new path table          */
/* ------------------------------------------------------------------ */

const moves = new Map(); // absolute old file -> absolute new file
for (const [from, to] of plan) {
  const src = abs(from);
  const dst = abs(to);
  if (!fs.existsSync(src)) throw new Error(`plan: ${from} does not exist`);
  if (fs.statSync(src).isDirectory()) {
    for (const f of listFiles(src)) moves.set(f, path.join(dst, path.relative(src, f)));
  } else {
    moves.set(src, dst);
  }
}
for (const [, dst] of moves) {
  if (fs.existsSync(dst) && !moves.has(dst)) {
    throw new Error(`plan: target already exists and is not moving away: ${norm(path.relative(ROOT, dst))}`);
  }
}
const newLocation = (file) => moves.get(file) ?? file;

/* ------------------------------------------------------------------ */
/* 2. Find every relative specifier and compute its replacement         */
/* ------------------------------------------------------------------ */

// from "x" | import "x" | import("x") | vi.mock("x") | vi.importActual("x")
const SPECIFIER =
  /(\bfrom\s*|\bimport\s*(?:\(\s*)?|\bvi\.(?:mock|importActual|doMock)\(\s*)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

function resolveTarget(fromFile, spec) {
  const [bare, query = ""] = spec.split(/(?=\?)/);
  const base = path.resolve(path.dirname(fromFile), bare);
  const candidates = [base, `${base}.ts`, `${base}.mts`, `${base}.js`, path.join(base, "index.ts")];
  const hit = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  return hit ? { target: hit, query, hadExt: path.extname(bare) !== "" } : null;
}

function specifierFor(fromNew, targetNew, { query, hadExt }, original) {
  let rel = norm(path.relative(path.dirname(fromNew), targetNew));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  if (!hadExt && SOURCE_EXT.test(rel)) rel = rel.replace(SOURCE_EXT, "");
  // "./dir/index" written as "./dir" stays a directory import
  if (!hadExt && /\/index$/.test(rel) && !/\/index$/.test(original.split("?")[0])) {
    rel = rel.replace(/\/index$/, "");
  }
  return rel + query;
}

const files = SCAN_DIRS.flatMap((d) => listFiles(abs(d))).filter((f) => SOURCE_EXT.test(f));
const rewrites = []; // { file, newFile, before, after, count }
let unresolved = 0;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const fileNew = newLocation(file);
  let count = 0;
  const out = text.replace(SPECIFIER, (whole, lead, quote, spec) => {
    const hit = resolveTarget(file, spec);
    if (!hit) {
      unresolved++;
      console.warn(`  ? unresolved ${spec} in ${norm(path.relative(ROOT, file))}`);
      return whole;
    }
    const next = specifierFor(fileNew, newLocation(hit.target), hit, spec);
    if (next === spec) return whole;
    count++;
    return `${lead}${quote}${next}${quote}`;
  });
  if (count || fileNew !== file) rewrites.push({ file, fileNew, out, changed: out !== text, count });
}

/* ------------------------------------------------------------------ */
/* 3. Report, and apply when asked                                      */
/* ------------------------------------------------------------------ */

const total = rewrites.reduce((t, r) => t + r.count, 0);
console.log(`${moves.size} file(s) to move, ${total} import(s) to rewrite in ${rewrites.filter((r) => r.count).length} file(s).`);
if (unresolved) console.log(`${unresolved} relative import(s) could not be resolved (listed above): check them by hand.`);

if (!APPLY) {
  for (const [from, to] of moves) console.log(`  mv ${norm(path.relative(ROOT, from))} -> ${norm(path.relative(ROOT, to))}`);
  console.log("dry run: nothing written. Add --apply to do it.");
  process.exit(0);
}

// Write the rewritten text first (at the old path), then move with git so the
// history follows the file.
for (const r of rewrites) if (r.changed) fs.writeFileSync(r.file, r.out);
for (const [from, to] of moves) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  execFileSync("git", ["mv", norm(path.relative(ROOT, from)), norm(path.relative(ROOT, to))], { cwd: ROOT, stdio: "inherit" });
}
// Folders left empty by the moves
for (const [from] of plan) {
  const src = abs(from);
  const prune = (d) => {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) return;
    for (const e of fs.readdirSync(d)) prune(path.join(d, e));
    if (fs.readdirSync(d).length === 0) fs.rmdirSync(d);
  };
  prune(src);
}
console.log("applied. Now run: npx tsc --noEmit -p . && npx vitest run");
