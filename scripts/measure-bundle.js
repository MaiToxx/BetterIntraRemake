/**
 * Where do the bytes go, and are we still under budget.
 *
 *   node scripts/measure-bundle.js           # print the report, always exit 0
 *   node scripts/measure-bundle.js --check   # same report, exit 1 if over budget
 *
 * WHY raw bytes and not gzip decide pass/fail: an extension file is read from
 * disk, not downloaded, so nothing ever un-gzips it. What the browser pays on
 * every Intra page load is parsing the raw bytes of content.js. gzip is
 * reported anyway because it is the number the stores show and it tells you
 * whether a file grew by real logic or by repetitive text (CSS compresses ~8x).
 */
import fs from "fs";
import zlib from "zlib";
import { resolve, dirname, join, relative, sep } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/**
 * Size ceilings in KB (1024 bytes), keyed by the file's path inside a dist
 * folder. Both dist-chrome and dist-firefox are held to the same numbers:
 * the two builds only differ by their manifest.
 *
 * These are NOT aspirations, they are tripwires. Bump one only when a feature
 * genuinely needs the room, in the same commit that adds the feature, and say
 * so in the commit message. A silent bump defeats the whole file.
 *
 * Set from the v1.10.0 sizes, the release that moved the 300 KB
 * Tailwind/daisyUI sheet out of both JS bundles into shared-styles.css. The
 * headroom is a few percent on purpose: enough for a feature, not enough for
 * the sheet to creep back into the JavaScript.
 */
const BUDGETS_KB = {
  "content.js": 680, // v1.16.0: 667 KB, of which 56 KB is the French catalog (784 texts, the English text is the key); v1.14.0: 599 KB (theme colours +12, upload-on-save editor +7, mobile and hub work); v1.13.0: 564 KB
  "popup.js": 64, // v1.16.0: 61 KB, of which 9 KB is the popup's own French catalog (the build keeps only its texts); v1.14.0: 51 KB (sign-in disclosure the Chrome Web Store requires, sign-in feedback, Open settings); v1.13: 42 KB
  "auth-callback.js": 20, // v1.16.0: 19 KB with its French texts (dormant in intra mode, never registered); v1.10.0: 10 KB
  "background.js": 14, // v1.16.0: 11.8 KB (release check per browser, the store build flag, one French text); v1.10.0: 5 KB
  "hook.js": 8, // v1.10.0: 4 KB
  // Stylesheets are served as files: the browser parses each one once and
  // caches it, so they are budgeted separately from the code.
  // Lowered with the theme split: at 180 the 34 presets could move back in unnoticed.
  "shared-styles.css": 140, // v1.11.0: 127 KB (Tailwind scans src/ only, 23 daisyUI components, light/dark only)
  "shared-themes.css": 64, // v1.14.0: 56 KB, 56 presets (22 new palettes), fetched only when a named preset is selected
  "theme-dark-v2.css": 72, // v1.10.0: 62 KB (fetched on the v2 Intra only)
};

/** Built output we know about. A folder that is not there is simply skipped. */
const DIST_DIRS = ["dist-firefox", "dist-chrome"];

/** Only literals at least this long are worth naming in the report. */
const LITERAL_MIN_BYTES = 1500;

/** Scan for big literals only in files this size or above; smaller is noise. */
const LITERAL_SCAN_MIN_BYTES = 50 * 1024;

const KB = 1024;

const check = process.argv.includes("--check");

/** Human size, always in KB so the columns compare at a glance. */
function kb(bytes) {
  return `${(bytes / KB).toFixed(1)} KB`;
}

/** Every file under `dir`, relative posix-ish paths, deepest last. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

/** Candidate literals delimited by one quote character, in source order. */
function scanQuote(source, quote) {
  const found = [];
  let i = 0;
  while ((i = source.indexOf(quote, i)) !== -1) {
    let j = i + 1;
    let closed = false;
    while (j < source.length) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === quote) {
        closed = true;
        break;
      }
      // an unescaped newline ends a normal string: this was not one
      if (quote !== "`" && c === "\n") break;
      j++;
    }
    if (closed && j - i + 1 >= LITERAL_MIN_BYTES) found.push({ start: i, end: j });
    i = closed ? j + 1 : i + 1;
  }
  return found;
}

/**
 * Longest string literals in a minified JS file, biggest first.
 *
 * This deliberately does not parse JavaScript. Each quote character gets its
 * own pass, then the candidates are taken longest-first and anything that
 * overlaps an already-taken span is dropped -- so the `"..."` strings *inside*
 * a huge template literal are not counted twice, and one pass losing sync on a
 * regex like /"/g cannot hide what the other passes found. That is enough to
 * spot "a 300 KB stylesheet lives in here" and cheap enough for a 1 MB file.
 * Still approximate: a template literal is counted with whatever `${...}` it
 * interpolates. Treat the output as a map, not as an accounting statement.
 */
function bigLiterals(source) {
  const candidates = [
    ...scanQuote(source, '"'),
    ...scanQuote(source, "'"),
    ...scanQuote(source, "`"),
  ].sort((a, b) => b.end - b.start - (a.end - a.start));

  const taken = [];
  for (const c of candidates) {
    if (taken.some((t) => c.start <= t.end && t.start <= c.end)) continue;
    taken.push(c);
  }
  return taken.map((c) => ({
    length: c.end - c.start + 1,
    head: source.slice(c.start + 1, c.start + 61).replace(/\s+/g, " "),
  }));
}

/** Measure one dist folder; returns null when it has not been built. */
function measure(dirName) {
  const dir = resolve(root, dirName);
  if (!fs.existsSync(dir)) return null;

  const files = walk(dir).map((rel) => {
    const buf = fs.readFileSync(join(dir, rel));
    const budgetKb = BUDGETS_KB[rel];
    return {
      rel,
      raw: buf.length,
      gzip: zlib.gzipSync(buf, { level: 9 }).length,
      budget: budgetKb === undefined ? null : budgetKb * KB,
      over: budgetKb !== undefined && buf.length > budgetKb * KB,
      source: rel.endsWith(".js") ? buf.toString("utf8") : null,
    };
  });
  files.sort((a, b) => b.raw - a.raw);
  return { dirName, files };
}

/** Print one folder's table and return how many files blew their budget. */
function report(result) {
  const { dirName, files } = result;
  const totalRaw = files.reduce((t, f) => t + f.raw, 0);
  const totalGzip = files.reduce((t, f) => t + f.gzip, 0);

  const nameWidth = Math.max(16, ...files.map((f) => f.rel.length));
  const head = (s) => s.padEnd(nameWidth);
  console.log(`\n${dirName}`);
  console.log(
    `  ${head("file")}${"raw".padStart(11)}${"gzip".padStart(11)}${"budget".padStart(11)}  status`,
  );

  let over = 0;
  for (const f of files) {
    const budget = f.budget === null ? "-" : kb(f.budget);
    let status = "";
    if (f.budget !== null) {
      const left = f.budget - f.raw;
      status = f.over ? `OVER by ${kb(-left)}` : `ok (${kb(left)} left)`;
      if (f.over) over++;
    }
    console.log(
      `  ${head(f.rel)}${kb(f.raw).padStart(11)}${kb(f.gzip).padStart(11)}${budget.padStart(11)}  ${status}`.trimEnd(),
    );
  }
  console.log(
    `  ${head("TOTAL")}${kb(totalRaw).padStart(11)}${kb(totalGzip).padStart(11)}`,
  );

  for (const f of files) {
    if (!f.source || f.raw < LITERAL_SCAN_MIN_BYTES) continue;
    const literals = bigLiterals(f.source);
    if (literals.length === 0) continue;
    const sum = literals.reduce((t, l) => t + l.length, 0);
    console.log(
      `\n  ${f.rel}: ~${kb(sum)} of it is ${literals.length} long string literals (approx.)`,
    );
    for (const l of literals.slice(0, 5)) {
      console.log(`    ${kb(l.length).padStart(10)}  ${l.head}`);
    }
  }
  return over;
}

const results = DIST_DIRS.map(measure);
const built = results.filter(Boolean);
const missing = DIST_DIRS.filter((d, i) => results[i] === null);

if (built.length === 0) {
  console.log("nothing built, nothing checked");
  console.log(`  no ${DIST_DIRS.join(" / ")} folder -- run npm run build:firefox first`);
  // --check is a gate: "I could not look" must never read as "it passed".
  process.exit(check ? 1 : 0);
}

let over = 0;
for (const result of built) over += report(result);
for (const dirName of missing) console.log(`\n${dirName}\n  not built, skipped`);

if (!check) {
  console.log("\nBudgets are only enforced with --check (npm run check:size).");
  process.exit(0);
}

if (over > 0) {
  console.error(
    `\ncheck:size FAILED: ${over} file(s) over budget. Trim the feature, or raise` +
      " the budget in scripts/measure-bundle.js on purpose and say why.",
  );
  process.exit(1);
}
console.log("\ncheck:size ok: every built file is within its budget.");
