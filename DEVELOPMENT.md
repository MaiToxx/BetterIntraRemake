# Development

## Prerequisites

- Node.js
- npm

## Setup

```bash
git clone https://github.com/nicopasla/better-intra.git
cd better-intra
npm install
```

## Commands

```bash
npm run dev:firefox     # watch + web-ext auto-reload in Firefox
npm run dev:chrome      # watch + web-ext auto-reload in Chrome
npm run dev:brave       # watch + web-ext auto-reload in Brave
npm run build:firefox   # single production build for Firefox
npm run build:chrome    # single production build for Chrome
npm test                # vitest (jsdom)
npm run measure         # size of every built file, and what fills the bundles
npm run check:size      # fails when a built file is over its budget (CI)
npm run check:cycles    # fails on a runtime import cycle in src/ (CI)
npm run generate:themes # themes.json + style.css theme blocks + hub list from scripts/themes/palettes.mjs
npm run smoke:firefox -- dist-firefox                    # automated Firefox smoke + timings
npm run smoke:firefox -- --compare <build-A> <build-B>   # side-by-side timing table
```

The Firefox harness needs a Firefox binary: `npx @puppeteer/browsers install firefox@stable --path .browsers` puts a portable copy in `.browsers/` (gitignored), or pass `--firefox <path>`. `npm run smoke:chrome -- dist-chrome` runs the same checks in an installed Chrome (`--chrome <path>` or `CHROME_BIN` otherwise); CI runs it on every push. Both serve a synthetic Intra page under the real `https://profile-v3.intra.42.fr` origin; see docs/FIREFOX-TESTING.md.

Output goes to `dist-firefox/` or `dist-chrome/`.

## Build pipeline

Always `tsc` (type-check only, `noEmit`) → `vite build` (content script) → `vite build --config vite.popup.config.ts` (popup) → `vite build --config vite.background.config.ts` (background service worker) → `vite build --config vite.auth.config.ts` (`auth-callback.js`, content script for the worker's OAuth callback page so the login completes even when the opener window is gone). The last one only matters in `config.authMode: "oauth"`: in intra mode (this deployment) `finalizeManifest()` leaves it out of the manifest.

```bash
cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox tsc && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build --config vite.popup.config.ts && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build --config vite.background.config.ts
```

- `content.js` is bundled as IIFE. `popup.js` is bundled separately. `background.js` is bundled as IIFE.
- `manifest.json` is generated from `manifests/manifest.{chrome,firefox}.json` by `finalizeManifest()` in `vite.config.ts`: version from `package.json`, worker origin from `config.workerUrl`, Firefox id and update URL from `repository`, the `/callback` content script only in oauth mode. `tests/manifests.test.ts` checks it, and `tests/privacy-doc.test.ts` checks that PRIVACY.md names every permission and host the manifests ask for.
- Host permissions are `https://*.intra.42.fr/*` and the worker. `api.github.com` (release check, About tab) is reached as a plain CORS request. The Chrome manifest sets `minimum_chrome_version` 111 (MAIN-world content scripts).
- Icons are copied from `public/icons/` on build. To regenerate: `node scripts/generate-icons.js` (requires `sharp`).

## Project structure

- `src/main.ts` — content script entrypoint. Feature init via `featureInitializers` map.
- `src/background.ts` — background service worker: GitHub release check on a 6-hour alarm, Intra page fetches for content scripts (with the user's cookies), tab reload after login. Nothing else runs in the background.
- `src/popup/popup.ts` — popup entrypoint (account/cloud sync UI).
- `src/core/` — what every feature uses and no feature owns. It never imports from `src/features/`.
  - `config.ts` — the public entry point for settings (`getConfig`, `getConfigMany`, `setConfig`, `CONFIG_DEFAULT`...), over `config/`: `schema.ts` (the `BetterIntraConfig` interface), `defaults.ts`, `keys.ts` (cloud-synced keys), `snapshot.ts` (the in-memory settings snapshot, one storage read per context; read its comment before touching it), `access.ts`.
  - `styles/` — `style.css` (Tailwind + daisyUI, built to `shared-styles.css` and `shared-themes.css`) and `shared-styles.ts`, which hands the sheets to shadow roots. docs/PERFORMANCE.md explains the two ways to use it and why the choice matters.
  - `theme/` — the theme manager and the Intra theme sheets.
  - `dom/` — `dom-wait.ts` (observer-based waits and visibility-aware tickers: use them instead of `setInterval` polling), tooltips, skeletons, dialogs, countdown, `svg.ts` (bundled icons without HTML strings).
  - `security/` — CSS value sanitisers for anything that ends up in a stylesheet.
  - `intra/` — Intra knowledge: `intrapy.ts`, the page selectors, profile login detection.
  - `lifecycle/` — `stale-instance.ts`, imported first by `main.ts`: after an add-on update, an open tab still holds the old instance's nodes (dead gear and Clusters button, a second friends widget). It removes them and the "already bound" flags before anything mounts. `own-ids.ts` lists the id prefixes the extension owns; add yours there when a feature mounts a node with a new id.
- `src/features/` — self-contained features: `account/`, `announcement/`, `calendar/`, `campus/`, `clusters/`, `customize/`, `eggs/`, `friends/`, `hub/` (`settings/` one data module per tab, `controls/` one renderer per setting family), `logtime/`, `performance/`, `profile/` (`header/`, `cards/`, `layout/`, `extras/`), `shortcuts/`, `subjects/`.
- `scripts/move-modules.mjs` — move files and rewrite every relative import that points at them (`git mv` keeps history); dry run by default. `scripts/reorganise-plan.json` is the plan used for the 1.11.0 layout.
- `manifests/` — per-browser manifest templates.
- `../better-intra-worker` — the Cloudflare Worker (wrangler) behind the cloud features, a sibling repository with its own `package.json`.

## Auth mode

`package.json` `config.authMode` selects how *Connect with 42* works and is compiled in as `AUTH_MODE` (`src/core/worker.ts`). This deployment uses `"intra"`: the extension sends the Intra session JWT (issued by `auth.42.fr`, captured by `hook.js`) once to the worker's `/auth/intra`, the worker verifies it against 42's JWKS and returns a random session token that the extension stores as `CLOUD_TOKEN`. Friends, correction stats and roulette history are then read from the Intra with the user's own session. `"oauth"` is upstream's flow (a 42 application on the worker, `/login`, `/callback` and `src/auth-callback.ts`); its code paths stay in the tree and are tested (`tests/friends-data-oauth.test.ts`) but are never taken here.

## Toolchain

- **Vite 8** + `@tailwindcss/vite` plugin (Tailwind v4 CSS-driven config, no `tailwind.config.js`).
- **daisyUI 5** — loaded via `@plugin "daisyui"` in `src/core/styles/style.css`. Scoped to shadow DOM roots. Only a subset of components included: button, toggle, input, select, radio, label, card, tabs, modal, divider, swap, fieldset, status, tooltip, badge, collapse, ring, avatar, indicator, list, loading, join, kbd, dropdown, menu.
- **TypeScript 7** — `strict: true`, `moduleResolution: bundler`, `types: ["chrome"]`.
- **lit-html** — DOM templating for settings UI and popup.
- **web-ext** — running and signing the extension.
- **Icons**: Font Awesome SVG icons in `src/assets/svg/`.

## Worker

The Cloudflare Worker (`../better-intra-worker`) handles the Intra-token sign-in, settings sync, public visuals and looks, the calendar `.ics` feed, the subject tracker, the announcement and the public stats. It has its own `package.json`.

### Commands

```bash
cd ../better-intra-worker
npm install
npm run dev       # wrangler dev
npm run deploy    # wrangler deploy --remote (never without the user's explicit consent)
```

### Storage

- **`BETTER_INTRA_KV`** — one record per login hash (session tokens, settings) and small caches (JWKS, project map). The free plan allows 1,000 writes a day for the whole namespace.
- **D1** (`better_intra_d1`) — `users` (login hash, country, first sign-in; feeds `/api/v1/public/stats`), `calendar_ics`, subject tracker tables.

### Dormant oauth mode

The worker still contains upstream's OAuth login, evaluation notifications (Discord) and their crons. They need a 42 application (`CLIENT_ID`/`CLIENT_SECRET`) and `DISCORD_ENABLED`; without them every cron returns at once and the routes are never called by this extension. Keep them compiling, do not build on them.

## Testing

Tests use [Vitest](https://vitest.dev/) with `jsdom` environment. Test files are in `tests/`.

```bash
npm test           # vitest run (single pass)
npm run test:watch # vitest (watch mode)
```

Test files: `tests/*.test.ts`, one per feature or concern (about a hundred). Global setup (the `chrome.storage` mock) is in `tests/setup.ts`. `tests/no-html-injection.test.ts` enforces the no-`innerHTML` rule, `tests/manifests.test.ts` the manifest build, `tests/privacy-doc.test.ts` keeps PRIVACY.md in step with the manifests and the sync key list.

## Coding conventions

- **No `innerHTML`** — use `lit-html` (`render`, `unsafeHTML`) for all DOM templating.
- Features register in the `featureInitializers` map in `src/main.ts`.

## CI

- **CI** (`ci.yaml`) — on push/PR: type-check, tests, both builds, the Chrome smoke test in the runner's Chrome (soft-skipped when none is found), size budgets, import cycles.
- **Release drafter** — on push/PR to `main`; auto-categorizes commits.
- **Publish** — triggers on GitHub Release publish; builds Firefox (`.xpi`) and Chrome (`.zip`); signs Firefox via AMO for full releases.

## Formatting

Prettier is used for formatting (editor-level; no project config file committed). No linter is configured.
