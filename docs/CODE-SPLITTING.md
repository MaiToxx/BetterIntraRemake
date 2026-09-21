# Code splitting

The content script is split. `content.js` used to be one IIFE, so every
`import()` in `src/` was inlined: the hub, the cluster map, the profile editor,
the particle effects, the easter-egg effects and qrcode-generator were parsed
on every Intra page, even if the user never opened them. Now `content.js` is a
1.6 KB classic loader, the app is the ES module `content-main.js`, and those
features are chunks loaded the first time they are used. This page describes
what ships, the rules that keep it correct, and what still has to be tested
in Firefox before a release.

Measured on 2026-09-21 with Vite 8.3.0 and rolldown 1.2.7, Firefox target
(the Chrome build is byte for byte the same apart from `manifest.json`).
Sizes are raw bytes on disk (KB = 1024 B), with gzip -9 for reference, the
same convention as `npm run measure`. The baseline is `dist-baseline-iife`, a
copy of the v1.11.0 release build. A number that was not measured is marked
*estimate*.

## Numbers

### What a normal Intra page loads

| build | files | raw | gzip |
| --- | ---: | ---: | ---: |
| v1.11.0: `content.js` IIFE | 1 | 556.7 KB (570,047 B) | 167.5 KB |
| split: `content.js` (loader) | 1 | 1.6 KB (1,608 B) | 0.8 KB |
| split: `content-main.js` (app) | 1 | 378.8 KB (387,931 B) | 115.2 KB |
| **split, both** | 2 | **380.4 KB (389,539 B), −31.7 %** | 115.9 KB |

All the content-script JS together (loader, app and every chunk) comes to
570,299 B, 252 B more than the IIFE: the package does not grow, the bytes only
move. The popup, background and auth-callback builds are unchanged, except
that `popup.js` is 639 B larger (39,962 B): the popup imports `eggs.ts` and
`extras-apply.ts` (for `toast` and `pickRawExtras`), and their new `import()`
calls make rolldown wrap the popup's shared modules in lazy initialisers. The
imports themselves are tree-shaken out of `popup.js`.

### The lazy chunks

"Extra" is what the first trigger adds on top of the app, including the small
shared chunks it pulls in (`grip-vertical` 2,973 B, `presets` 2,539 B,
`reset` 1,284 B).

| chunk | extra raw | gzip | loaded when |
| --- | ---: | ---: | --- |
| `hubSettings.ui` (+ `presets`, `reset`, `grip-vertical`) | 72.0 KB (73,701 B) | 22.1 KB | the sidebar gear is clicked |
| `map-dialog` (+ `reset`) | 48.9 KB (50,093 B) | 14.2 KB | the Clusters sidebar button, the Clusters link of the personal-info block, the seat badge (profile-card.ts) or a seat label (highlight.ts) is clicked |
| `profile.modal` (+ `grip-vertical`) | 25.8 KB (26,465 B) | 7.1 KB | the user clicks their own avatar (the profile editor) |
| `qr` (qrcode-generator) | 20.5 KB (21,010 B) | 7.2 KB | the hub's calendar panel renders while a sync token exists |
| `extras-effects` | 7.3 KB (7,500 B) | 3.0 KB | a profile's extras ask for a particle effect, and the viewer does not prefer reduced motion |
| `eggs-effects` | 6.1 KB (6,248 B) | 2.4 KB | an egg with a visual effect is triggered: konami, barrel, matrix, maxwell, 7 gear clicks, a 42h00 month |
| `presets` | 2.5 KB (2,539 B) | 1.2 KB | the 7th fast gear click (hacker egg); otherwise it loads with the hub |

The calendar panel itself stays in the hub chunk: the hub renders every tab
panel when it opens (`tab-panel.ts`), so a separate chunk would load right
after the hub every time. Only qrcode-generator is deferred.

## How it is built

```
content.js         classic content script, document_start, 1.6 KB, no state
  ├─ injects hook.js
  ├─ applies the cached theme (classes + <link data-better-intra-theme>)
  ├─ avatar pre-hide observer + 5 s fail-safe
  └─ import(chrome.runtime.getURL("content-main.js"))
       content-main.js   ES module: everything with state, evaluated once
         ├─ import("./chunks/hubSettings.ui-[hash].js") ── import("./qr-[hash].js")
         ├─ import("./chunks/map-dialog-[hash].js")
         ├─ import("./chunks/profile.modal-[hash].js")
         ├─ import("./chunks/extras-effects-[hash].js")
         ├─ import("./chunks/eggs-effects-[hash].js")
         └─ import("./chunks/presets-[hash].js")
       every chunk that needs shared code imports it from "../content-main.js"
```

- `vite.config.ts` builds `src/main.ts` with `format: "es"`, the fixed entry
  name `content-main.js`, hashed chunk names (`chunks/[name]-[hash].js`) and
  one `codeSplitting` group with `tags: ["$initial"]`, which keeps every
  module the entry imports statically in `content-main.js` itself. Without it,
  rolldown puts the modules the entry shares with a lazy chunk (lit-html,
  config, customize, ...) into small extra chunks that every page loads anyway.
- `vite.loader.config.ts` builds `src/loader.ts` into `content.js` as an IIFE,
  with no `public/` copy. It runs right after the content build in every
  `build:*` and `watch:*` script of `package.json`.
- Both manifests keep `content.js` as the only content script on
  `https://*.intra.42.fr/*` (document_start) and add `content-main.js` and
  `chunks/*.js` to its `web_accessible_resources` entry. Firefox MV3 needs
  that for an `import()` from a content script (bug 1803950), and Chrome needs
  it too. Both browsers accept `*` in `resources`.
- **Vite's preload helper is replaced.** Vite wraps every `import()` in
  `__vitePreload()`, which on a web page adds
  `<link rel="modulepreload" href="/chunks/...">` for a chunk's static imports
  and dispatches `vite:preloadError` on `window` when a load fails. Here the
  page is the Intra. `build.modulePreload: false` empties the lists, and
  `noPreloadHelperPlugin()` (vite.config.ts, used by both builds) replaces the
  helper with `(load) => load()` and fails the build if `modulepreload` or
  `vite:preloadError` is left in any chunk. `cssCodeSplit: false` still keeps
  the one stylesheet on disk, so no chunk has CSS to preload.
- The output folder is never emptied (four builds share it), so
  `pruneStaleChunksPlugin()` deletes every file of `chunks/` that the current
  build did not write. Without it every rebuild would leave the previous
  chunks in the package.
- `scripts/measure-bundle.js` has budgets for `content.js` (4 KB),
  `content-main.js` and each named chunk (by pattern, `*` = the hash), plus a
  catch-all for any other chunk. It also takes folder names, for example
  `node scripts/measure-bundle.js dist-split-firefox`.

### Stale tabs

Chunk names carry a content hash, and the hash changes whenever the chunk's
bytes change, including the names it imports from `content-main.js`
(verified: a change that renumbers the entry's exports renames the chunks
that import them). A tab left open across an update (mostly Chrome, where the
orphaned content script keeps running) either finds a byte-identical chunk,
which binds correctly to its old entry, or gets a clean 404. Every lazy call
site catches it, logs one `console.warn("Better Intra: ...")` and does
nothing else.

## What stays synchronous in the loader

Everything `main.ts` did before its first `await` either needs to beat the
page's own scripts or its first paint, or it only registers something. The
first three items below are in `src/loader.ts`.

1. **hook.js injection**, first. It wraps `window.fetch` before the Intra app
   sends its first request, which is how the token, the campus and the
   logtime payload are seen. Inside the module graph it would run later by
   the import latency, and the first fetches could go unseen.
2. **Cached theme.** The loader reads `sessionStorage["intra-theme"]` and does
   the synchronous part of `applyTheme()`: the `dark` class, `data-theme` on
   v3, and the page theme `<link>` (`darkV3`/`lightV3` on profile-v3, `darkV2`
   elsewhere for dark). It never writes sessionStorage and does not build the
   preset `<style>`, which needs a settings read. Blocked storage is caught;
   the app then applies the theme when it has read the settings, as it did
   when nothing was cached.
   - `theme-manager.ts` keeps its links in a module-level `Map`. Before its
     first theme operation it adopts every `link[data-better-intra-theme]`
     already in the document (`adoptLoaderLinks()`), keeping one per sheet
     and removing duplicates left by a previous instance. Without this it
     would create a second link, and a later theme switch would only turn off
     its own: the loader's sheet would stay on (stuck dark). The sheet whose
     name the manager never asks for (cached dark, light in the settings) is
     switched off too, since it is in the map.
   - The sheet names and files, the link id and the v3 host are written in
     both files. `THEME_SHEETS` and `STYLESHEET_ID` are exported by
     `theme-manager.ts`, and `tests/loader.test.ts` checks the loader's links
     against them and runs the manager after the loader.
3. **Avatar pre-hide and its 5 s fail-safe**, together. The observer only sees
   *added* nodes. Started from the graph after React has inserted the avatar,
   it would never fire: the Intra picture would flash before the custom
   avatar, and the observer would stay connected. The fail-safe is in the
   loader too, so the avatar comes back even if the graph fails to load.

Everything else is in `main.ts`, unchanged and in the same order: the
`onMessage` listener (the popup's Intra login already reports "not running on
this tab yet"), `initThemeManager`, `initCustomize`, `initPerfStyles`, the
perf observers, the eggs, the announcement, the tooltips, the v2 banner and
`runBetterIntra` with the auth callback. All of them handle a `readyState`
that is no longer `"loading"`. One visible difference: when the app starts,
`<body>` usually exists, so `applyTheme()` now sets `body.dark` on the first
pass; before, that only happened on a later switch.

## Lazy boundaries

| boundary | where | on failure | guard |
| --- | --- | --- | --- |
| cluster map | `clusters/open-map.ts` wraps `import("./map-dialog.ts")`; hubSettings.ts, personal-info.ts, profile-card.ts and highlight.ts import the wrapper. `map-dialog/seats.ts` stays eager (highlight.ts) | warn, no dialog | map-dialog.ts's own `opening` guard, in the one module instance |
| profile editor | `avatar-clicks.ts` imports `profile.modal.ts` on click | warn, the next click retries | `opening`: clicks during the import and the editor's own awaits join the first open |
| particle effects | `extras-apply.ts` imports `extras-effects.ts` on the first start; `none`, unknown effects and reduced motion never load it | warn, the rest of the extras show | a ticket per start and stop: a stop during the load cancels the pending start |
| easter eggs | the six effects are in `eggs-effects.ts`; `eggs.ts` keeps the triggers, `toast` and wrappers with the same names | warn, the egg is still recorded and toasted | none needed |
| hacker preset | `eggs.ts` imports `presets.ts` on the 7th gear click | warn, no preset | none needed |
| calendar QR | `calendar.ui.ts` imports `qr.ts` when there is a token | warn, no picture (the link shows) | the latest `update()` wins |
| hub | `hubSettings.ts` (was already lazy) | warn | none needed |

`tests/lazy-boundaries.test.ts` mocks each chunk: nothing is imported before
first use, the first use imports it and calls into it, and a chunk that
throws on load fails quietly.

## Exactly one instance of every stateful module

`src/core/config/snapshot.ts` wraps `chrome.storage.local.set/remove/clear`
and registers an `onChanged` listener. A second copy of the module would wrap
again: every write would be recorded twice, and there would be two snapshots.
The same goes for the theme manager's `Map`, the customize and perf
listeners, the shared constructed stylesheet, the cluster map's `opening`
guard, and so on.

What makes the split safe:

- An ES module is instantiated once per module map, keyed by its URL, and a
  content script has one module map per frame.
- A rolldown build puts every module in exactly one chunk: 229 modules over
  10 chunks, 0 duplicates, 163 of them in `content-main.js`. Every chunk with
  shared code imports `../content-main.js`.
- The loader bundle contains only `loader.ts`, `selectors.ts` (string
  constants) and the preload stub. It has no `chrome.storage`.

Rules, and what enforces them:

1. Everything with state lives in the ES graph. The loader imports only
   modules that hold constants: no top-level side effects, no module-level
   `let`. `tests/split-build.test.ts` fails if the built `content.js` mentions
   `chrome.storage` or `setItem`, grows past 4 KB, or bundles any module but
   `loader.ts` and `selectors.ts`; `tests/loader.test.ts` checks the sources.
2. The entry has one URL: `chrome.runtime.getURL("content-main.js")`, with no
   query string and no hash. A cache-buster would create a second instance of
   the whole app as soon as the first lazy chunk imports `../content-main.js`.
   The call is written inline in the `import()` (addons-linter flags an
   `import()` of a variable); the split test checks the built file.
3. There is one classic content script on `*.intra.42.fr`. No second
   `content_scripts` entry may bundle core. The split test checks the built
   manifests.
4. Keep the `$initial` group. With one eager chunk, modules evaluate
   dependency-first in a single file, as in the IIFE. Rolldown documents that
   placing modules in shared chunks can change the order unless
   `strictExecutionOrder` is on. `config/snapshot.ts` comes right after
   lit-html and the config defaults in `content-main.js`, and its listener is
   the first `onChanged` registration in the file: the ordering `snapshot.ts`
   relies on. The split test checks that the entry has no static imports.
5. Belt and braces: the three wrappers carry a
   `Symbol.for("better-intra.config.wrapper")` property
   (`WRITE_WRAPPER_MARK`). A second instance of `snapshot.ts` in the same realm
   sees it, does not wrap again, registers no listener, and reads storage
   directly (`tests/config-wrapper-guard.test.ts`).

## Risks

1. **Firefox time, not bytes.** As far as we know (not verified here),
   Firefox compiles `content_scripts` files once per process and reuses the
   compiled script. Files loaded with `import()` go through the module loader,
   and nobody has checked here whether it caches moz-extension: modules. So
   the split could save 32 % of the bytes and no time, or even cost time. This
   is the go/no-go measurement (test plan, step 7). Indicator only: V8 (Node
   24) compiled the eager entry in 5.0 ms against 7.7 ms for the IIFE, median
   of 41 runs; SpiderMonkey is not V8.
2. **First paint.** Customize, perf and preset CSS arrive later by the import
   latency (not measured; *estimate*: a few ms warm, more cold). The theme
   itself is safe because the loader applies it. If a flash shows, the loader
   can inject a cached copy of the generated customize CSS, the same way it
   handles `intra-theme`.
3. **Stale tabs after an update.** Handled as described above (hashed names,
   a `.catch` at every call site). An update or reload of the add-on while a
   tab is open still has to be tried (test plan, step 6).
4. **Races on first use.** The profile editor has an `opening` guard, a
   `stopEffect` during the load cancels the start, and the calendar keeps the
   latest render. The calendar QR still gets one more await on its first
   render.
5. **Vite's preload helper** is replaced by a pass-through (see above), so
   nothing can add a `<link rel="modulepreload">` to the Intra page or fire
   `vite:preloadError` there. If a Vite update renames the helper's module id,
   the stub stops applying and the build fails on the `modulepreload` check.
6. **Exposure to the page.** The chunks are fetchable by `*.intra.42.fr`
   pages, like hook.js and the CSS. They hold no secrets. A page that imports
   them into its own world fails at the first `chrome.storage` access.
7. **hook.js events.** The listeners attach later by the import latency. They
   already attached after DOMContentLoaded, and most have a replay: the token
   and the cursus id are in sessionStorage, and there is `42_LOGTIME_REQUEST`.
   `42_CAMPUS_DETECTED` has no replay.
8. **CSP.** Nobody has checked here whether Intra's CSP applies to a content
   script's module loads in Firefox (test plan, step 6).

## Firefox test plan

Build with the same commands as `npm run build:firefox`, into a folder of its
own (the integrator's copies are `dist-split-firefox` and `dist-split-chrome`;
`dist-baseline-iife` is the IIFE to compare with), and load it from
about:debugging. Test Firefox 140 ESR (`strict_min_version`) first, then the
current release. A test build only gets temporary instrumentation:
`console.count("better-intra graph")` at the top of `main.ts`, and
`performance.mark()` in the loader and at the entry.

1. **Loading** (profile-v3.intra.42.fr, own profile). No error in the
   content-script context (Browser Toolbox), the count is 1, and
   `content-main.js` is fetched once. Then remove `chunks/*.js` from
   `web_accessible_resources`: the hub must fail to open (one warning, nothing
   else), which confirms that bug 1803950 applies. Restore it.
2. **document_start** (same page, hard reload with dark, light and a colour
   preset).
   - No light flash on dark, exactly one `link[data-better-intra-theme]` per
     sheet, and dark → light → dark from the hub leaves one page sheet on.
   - The Intra picture does not flash before the custom avatar. With
     `content-main.js` renamed, the avatar comes back after 5 s.
   - The token is captured (the marks, freeze and achievements cards load), the
     logtime card gets its data, and with `CLUSTERS_CAMPUS` removed the campus
     is detected again and the Clusters button appears.
3. **One instance under use.** Open every lazy feature twice: the count must
   stay at 1. A setting changed in the hub reads back after reopening the hub,
   and another open tab follows.
4. **Every lazy chunk, first and second use.**
   - The hub gear, then 7 fast gear clicks (hacker preset and matrix rain).
   - The calendar tab, with and without a sync token (the QR code shows).
   - The Clusters sidebar button, the Clusters link in personal info, the
     seat badge and the seat labels.
   - The user's own avatar, including a fast double click (one modal only).
   - Another user's profile with a particle effect, left before the effect
     starts (no canvas left behind).
   - Every egg: konami, barrel, matrix, and maxwell twice.
5. **Other pages.** Test these pages:
   - profile.intra.42.fr v2 (the dark v2 sheet and the v2 banner)
   - profile-v3 for another user, and /users/...
   - at least one other subdomain without the sidebar (e.g.
     projects.intra.42.fr, meta.intra.42.fr), with no error
   - the auth callback (`?token=&login=` still closes the window)
   - a page restored from bfcache (back/forward)
6. **CSP and lifecycle.**
   - Look for CSP violations in the console on each subdomain.
   - Update or reload the add-on while a tab is open, then click the gear in
     that tab: it must fail cleanly, with no duplicate UI.
   - Use the popup's Intra login while a page is still loading.
7. **Performance, the go/no-go.** Use the Firefox Profiler (JS + screenshots)
   on profile-v3, own page, cold (first load after starting the browser) and
   warm (5 reloads), comparing the IIFE (`dist-baseline-iife`) with the split.
   Measure:
   - the time until the graph is evaluated
   - the time until the theme is applied
   - the time until the customize CSS is applied
   - the time until the first widget renders
   - the total compile and run time of the content script

   Ship only if the split is not slower warm and shows no new flash.
8. **Chrome.** Run steps 1 to 6 once.

## Next candidates (not done)

- The hub's setting definitions (`hub/settings/*`, 42,934 B rendered before
  minification) are eager only because `hubSettings.storage.ts` imports
  `FEATURE_DEFS` from `hubSettings.data.ts`, which also builds
  `HUB_SETTING_DEFS`. In the study, moving `HUB_SETTING_DEFS` to its own module
  took another 32 KB off the eager graph and moved it to the hub chunk. That
  changes the exports of `hubSettings.data.ts`, so it is a separate decision.
- What is still eager (rendered length before minification, study): profile
  34 %, logtime 11 %, hub 9 %, friends 8 %, inline SVG 8 %. An `import()` per
  entry of `featureInitializers` would keep a disabled feature's code off the
  page (not measured).

## How the numbers were produced

`dist-split-firefox` and `dist-split-chrome` were built with the exact
commands of `build:firefox` and `build:chrome` and a different
`BUILD_OUT_DIR`, then measured with
`node scripts/measure-bundle.js dist-split-firefox dist-split-chrome dist-baseline-iife`
(raw bytes from the files, gzip -9). The module counts per chunk come from
the `moduleIds` of the build output, as in `tests/split-build.test.ts`. The
V8 compile times are from the study that preceded this change.
