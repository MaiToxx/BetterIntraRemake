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
npm run smoke:firefox -- dist-firefox                    # automated Firefox smoke + timings
npm run smoke:firefox -- --compare <build-A> <build-B>   # side-by-side timing table
```

The Firefox harness needs a Firefox binary: `npx @puppeteer/browsers install firefox@stable --path .browsers` puts a portable copy in `.browsers/` (gitignored), or pass `--firefox <path>`. It serves a synthetic Intra page under the real `https://profile-v3.intra.42.fr` origin; see docs/FIREFOX-TESTING.md.

Output goes to `dist-firefox/` or `dist-chrome/`.

## Build pipeline

Always `tsc` (type-check only, `noEmit`) → `vite build` (content script) → `vite build --config vite.popup.config.ts` (popup) → `vite build --config vite.background.config.ts` (background service worker) → `vite build --config vite.auth.config.ts` (`auth-callback.js`, content script for the worker's OAuth callback page so the login completes even when the opener window is gone).

```bash
cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox tsc && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build --config vite.popup.config.ts && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build --config vite.background.config.ts
```

- `content.js` is bundled as IIFE. `popup.js` is bundled separately. `background.js` is bundled as IIFE.
- `manifest.json` is generated from `manifests/manifest.{chrome,firefox}.json` with version from `package.json`.
- Icons are copied from `public/icons/` on build. To regenerate: `node scripts/generate-icons.js` (requires `sharp`).

## Project structure

- `src/main.ts` — content script entrypoint. Feature init via `featureInitializers` map.
- `src/background.ts` — background service worker: update check, Intra page fetches for content scripts, tab reload after login.
- `src/popup/popup.ts` — popup entrypoint (account/cloud sync UI).
- `src/core/` — what every feature uses and no feature owns. It never imports from `src/features/`.
  - `config.ts` — the public entry point for settings (`getConfig`, `getConfigMany`, `setConfig`, `CONFIG_DEFAULT`...), over `config/`: `schema.ts` (the `BetterIntraConfig` interface), `defaults.ts`, `keys.ts` (cloud-synced keys), `snapshot.ts` (the in-memory settings snapshot, one storage read per context; read its comment before touching it), `access.ts`.
  - `styles/` — `style.css` (Tailwind + daisyUI, built to `shared-styles.css` and `shared-themes.css`) and `shared-styles.ts`, which hands the sheets to shadow roots. docs/PERFORMANCE.md explains the two ways to use it and why the choice matters.
  - `theme/` — the theme manager and the Intra theme sheets.
  - `dom/` — `dom-wait.ts` (observer-based waits and visibility-aware tickers: use them instead of `setInterval` polling), tooltips, skeletons, dialogs, countdown, `svg.ts` (bundled icons without HTML strings).
  - `security/` — CSS value sanitisers for anything that ends up in a stylesheet.
  - `intra/` — Intra knowledge: `intrapy.ts`, the page selectors, profile login detection.
- `src/features/` — self-contained features: `account/`, `announcement/`, `calendar/`, `campus/`, `clusters/`, `customize/`, `eggs/`, `friends/`, `hub/` (`settings/` one data module per tab, `controls/` one renderer per setting family), `logtime/`, `performance/`, `profile/` (`header/`, `cards/`, `layout/`, `extras/`), `shortcuts/`, `subjects/`.
- `scripts/move-modules.mjs` — move files and rewrite every relative import that points at them (`git mv` keeps history); dry run by default. `scripts/reorganise-plan.json` is the plan used for the 1.11.0 layout.
- `manifests/` — per-browser manifest templates.
- `better-intra-worker/` — separate Cloudflare Worker (wrangler) for cloud sync. Has its own `package.json`.

## Toolchain

- **Vite 8** + `@tailwindcss/vite` plugin (Tailwind v4 CSS-driven config, no `tailwind.config.js`).
- **daisyUI 5** — loaded via `@plugin "daisyui"` in `src/core/styles/style.css`. Scoped to shadow DOM roots. Only a subset of components included: button, toggle, input, select, radio, label, card, tabs, modal, divider, swap, fieldset, status, tooltip, badge, collapse, ring, avatar, indicator, list, loading, join, kbd, dropdown, menu.
- **TypeScript 6** — `strict: true`, `moduleResolution: bundler`, `types: ["chrome"]`.
- **lit-html** — DOM templating for settings UI and popup.
- **web-ext** — running and signing the extension.
- **Icons**: Font Awesome SVG icons in `src/assets/svg/`.

## Worker

The Cloudflare Worker (`better-intra-worker/`) handles cloud settings sync, friend data, and evaluation notifications. It has its own `package.json`.

### Commands

```bash
cd better-intra-worker
npm install
npm run dev       # wrangler dev
npm run deploy    # wrangler deploy --remote
```

### KV namespaces

- **`BETTER_INTRA_KV`** — user data (session tokens, settings, encrypted 42 token, project map, friend IDs cache, online cache).

### Secrets

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
```

### Evaluations architecture

Worker cron (`*/10 * * * *`) fetches 42 API `/v2/me/scale_teams` for each user, detects state changes (`null → booked → revealed`), and sends Discord DMs. Evaluation states are stored in Cloudflare D1 (`eval_states` table).

## Testing

Tests use [Vitest](https://vitest.dev/) with `jsdom` environment. Test files are in `tests/`.

```bash
npm test           # vitest run (single pass)
npm run test:watch # vitest (watch mode)
```

Test files: `config.test.ts`, `marks.test.ts`, `visuals.test.ts`, `friends.test.ts`. Global setup is in `tests/setup.ts`.

## Coding conventions

- **No `innerHTML`** — use `lit-html` (`render`, `unsafeHTML`) for all DOM templating.
- Features register in the `featureInitializers` map in `src/main.ts`.

## CI

- **Release drafter** — on push/PR to `main`; auto-categorizes commits.
- **Publish** — triggers on GitHub Release publish; builds Firefox (`.xpi`) and Chrome (`.zip`); signs Firefox via AMO for full releases.

## Formatting

Prettier is used for formatting (editor-level; no project config file committed). No linter is configured.
