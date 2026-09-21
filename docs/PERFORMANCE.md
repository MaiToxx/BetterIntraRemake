# Performance

What Better Intra costs on an Intra page, what it gives back, and how to keep
the numbers from creeping up.

## What it costs today

Measured on the minified v1.10.0 build (`npm run measure`, `dist-firefox`;
`dist-chrome` is the same output with a different manifest):

| file                     |      raw |    gzip | loaded                              |
| ------------------------ | -------: | ------: | ----------------------------------- |
| `content.js`             | 606.7 KB | 179.0 KB | on every `*.intra.42.fr` page       |
| `shared-styles.css`      | 300.7 KB |  37.4 KB | once, then served from cache        |
| `theme-dark-v2.css`      |  62.4 KB |  10.4 KB | only on the old v2 Intra            |
| `popup.js`               |  34.4 KB |  11.2 KB | when the popup opens                |
| `theme-dark-v3.css`      |  12.3 KB |   2.7 KB | with the dark theme on v3           |
| `theme-light-v3.css`     |  10.0 KB |   2.2 KB | with a light theme preset           |
| `auth-callback.js`       |   9.8 KB |   4.3 KB | on the worker callback page         |
| `background.js`          |   5.1 KB |   1.9 KB | once per browser session            |
| `hook.js`                |   3.9 KB |   1.3 KB | injected into the page context      |

Raw is the number that matters. An extension file is read from disk, never
downloaded, so nothing un-gzips it: what the browser pays on an Intra page load
is parsing `content.js`.

### What changed in 1.10.0

| | v1.9.1 | v1.10.0 |
| --- | ---: | ---: |
| `content.js` | 968.9 KB | 606.7 KB |
| `popup.js` | 334.6 KB | 34.4 KB |
| Tailwind sheet parsed per page | 9 times (once per shadow root) | once |

The Tailwind + daisyUI sheet used to be a 300 KB string inside the JavaScript,
in **both** bundles, and it was concatenated into the `<style>` of every widget.
Each widget's text differed slightly, so the engine's identical-text cache
missed and it parsed those 300 KB again for every shadow root. Measured in
Chrome on nine roots: **54.4 ms** of style work, against **3.2 ms** when the
same sheet is a single constructable `CSSStyleSheet` shared by all of them.

It is now a real file (`shared-styles.css`) that the browser fetches once,
parses once and caches. `src/core/styles/shared-styles.ts` hands it out two ways, and
the difference matters:

- `adoptSharedStyles(root, extraCSS?)` — adopted sheets apply **after** a
  root's own `<style>`, so this is only for roots where the helper owns every
  stylesheet. The widget's own rules are adopted as a second sheet right after
  the shared one, which keeps the old order.
- `sharedStylesLink()` — a `<link>` rendered as the first node of a lit
  template, for roots that keep a `<style>` of their own. Tree order is
  preserved exactly.

Swapping one for the other on the wrong root silently changes which rules win.

## Where the bytes are

`npm run measure` lists the longest string literals in each bundle. After the
extraction, `content.js` has about 104 KB of literals across 23 strings: the
lit-html template texts of the widgets, the settings metadata and inline SVG.
No single one is over 16 KB. The rest is feature code.

## "Lighten the Intra" (Advanced tab)

These four settings are about the **Intra page**, not about this extension.
They cannot shrink `content.js`, which loads before any setting is read; what
they do is remove work the browser would otherwise do for the page itself. All
four are on by default and each can be turned off on its own.

- **Skip off-screen content** — `content-visibility: auto` on the repeated rows
  of the long cards (projects, achievements, evaluations, logtime months), so
  the browser stops laying out and painting what is scrolled out of sight. On a
  synthetic page of 400 rows, 90 % of the body's elements sit inside a deferred
  block. Every target is inside a fixed-height `md:h-96` card with its own
  scrollbar, so a wrong size estimate can only move that card's scrollbar, never
  the page. Guarded by `@supports`, so Firefox before 125 simply skips it.
- **Load images when needed** — adds `loading="lazy"` and `decoding="async"` to
  the page's own images. The honest part: `loading` only counts for images whose
  fetch has not started, so the win is on everything React mounts after the
  first paint (route changes, lists that grow as you scroll), while
  `decoding="async"` always moves the decode off the main thread.
- **Pause when the tab is hidden** — stops the page's CSS animations and
  transitions while you are looking at another tab. It cannot pause an animated
  GIF; CSS has no say over those.
- **Connect early to the image server** — a `preconnect` to `cdn.intra.42.fr`,
  which saves the DNS, TCP and TLS round trips on the first avatar, typically
  100 to 300 ms on a cold connection.

The extension also does less itself than it used to: the profile pass ignores
bursts of DOM changes that only contain its own writes, the polling timers are
gone (about 260 timer wake-ups per page load replaced by five observers and four
one-shot deadlines), and the start-up path makes roughly 24 fewer storage
round-trips.

## Measuring locally

```bash
npm run build:firefox   # or build:chrome; measure only reads built output
npm run measure         # per-file raw + gzip, and the biggest literals
npm run check:size      # same report, exits 1 if a file is over budget
```

With nothing built, `npm run measure` prints `nothing built, nothing checked`
and exits 0; `npm run check:size` prints the same line and exits **1**, because
"I could not look" must never read as "it passed".

The literal scan does not parse JavaScript — it jumps from quote to matching
quote and drops overlaps. It is a map of what fills a bundle, not an accounting
statement; the sizes it prints will not add up to the file exactly.

## The budget rule

`scripts/measure-bundle.js` holds one `BUDGETS_KB` constant: a ceiling per built
file, including the stylesheets. CI runs `npm run check:size` after both builds,
so a pull request that pushes a file past its ceiling goes red.

A budget is a tripwire, not a target. Raising one is allowed and sometimes right
— but only in the same commit as the feature that needs the room, with the
reason in the commit message. Never raise a budget to make CI green.
