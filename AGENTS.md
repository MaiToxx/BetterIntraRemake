# Better Intra — Agent Guide

## Quick start

```bash
npm install
npm run build:firefox   # single production build for Firefox
npm run build:chrome    # single production build for Chrome
npm run dev:firefox     # watch + web-ext hot-reload
```

## Project structure

- **`src/main.ts`** — content script entrypoint. Feature init via `featureInitializers` map. Runs on `https://*.intra.42.fr/*` at `document_start`.
- **`src/popup/popup.ts`** — popup entrypoint.
- **`src/features/`** — self-contained features: `account/`, `announcement/`, `calendar/`, `campus/`, `clusters/`, `customize/`, `eggs/`, `friends/`, `hub/`, `logtime/`, `performance/`, `profile/`, `shortcuts/`, `subjects/`.
- **`src/core/config.ts`** — single source of truth for all chrome.storage keys; typed `BetterIntraConfig` interface + defaults (`config/schema.ts`, `config/defaults.ts`, `config/keys.ts` for what cloud sync uploads).
- **`manifests/manifest.{chrome,firefox}.json`** — per-browser manifest templates. `finalizeManifest()` in `vite.config.ts` turns one into the shipped `manifest.json`: version from package.json, worker origin from `config.workerUrl`, Firefox id/update URL from `repository`, and in `authMode: "intra"` no content script on the worker's `/callback` page. `tests/manifests.test.ts` covers it; `tests/privacy-doc.test.ts` ties PRIVACY.md to the manifests.
- **`better-intra-worker`** (sibling repo, `../better-intra-worker`) — the Cloudflare Worker (wrangler) behind cloud sync, public visuals, the calendar feed and the subject tracker. Has its own `package.json`.

## Auth mode

`package.json` `config.authMode` is `"intra"` here (it becomes the `__AUTH_MODE__` define, read as `AUTH_MODE` in `src/core/worker.ts`). Signing in POSTs the Intra session JWT (from `auth.42.fr`, captured by `hook.js`) to the worker's `/auth/intra`; the worker verifies it against 42's JWKS and answers a random session token, stored as `CLOUD_TOKEN`. The `"oauth"` mode (upstream's 42 application, `/login` + `/callback`, `src/auth-callback.ts`) is dormant: `src/features/account/account.ts`, `friends.ts`, `logtime.ts` and `roulette-stats.ts` still branch on `AUTH_MODE`, and `tests/friends-data-oauth.test.ts` keeps that branch honest. Nothing in this deployment needs a 42 API token.

## Build quirks

Always set **both** `TARGET` and `BUILD_OUT_DIR` env vars (cross-env handles this). The build pipeline is: `tsc` → `vite build` (content script) → `vite build --config vite.popup.config.ts` (popup) → `vite build --config vite.background.config.ts` (background service worker) → `vite build --config vite.auth.config.ts` (`auth-callback.js`, the content script for the worker's OAuth callback page). In intra mode that last file is still emitted but the manifest no longer registers it, so it never runs.

```bash
cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox tsc && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build --config vite.popup.config.ts && cross-env TARGET=firefox BUILD_OUT_DIR=dist-firefox vite build --config vite.background.config.ts
```

- `tsc` type-checks only (`noEmit: true` in tsconfig.json).
- Output is `dist-firefox/` or `dist-chrome/` (gitignored).
- `content.js` is bundled as IIFE. `popup.js` is bundled separately. `background.js` is bundled as IIFE.
- `manifest.json` is generated on the fly from per-browser manifest templates.
- Icons are copied from `public/icons/` on build. To regenerate: `node scripts/generate-icons.js` (requires `sharp`).

## dev scripts

- `npm run dev:firefox` — watch mode + web-ext auto-reload with Firefox.
- `npm run dev:chrome` — watch mode + web-ext auto-reload with Chrome.
- `npm run dev:brave` — like Chrome but uses Brave binary path from `package.json`.

## Framework & toolchain

- **Vite 8** + `@tailwindcss/vite` plugin (no `tailwind.config.js` — Tailwind v4 CSS-driven config).
- **daisyUI 5** — loaded via `@plugin "daisyui"` in `src/core/styles/style.css`; only a subset of components included.
- **TypeScript 7** — `strict: true`, `moduleResolution: bundler`, `types: ["chrome"]`.
- **`lit-html`** — used for DOM templating in the settings UI (hub) and popup.
- **`web-ext`** — for running and signing the extension.
- **Icons**: Font Awesome SVG icons in `src/assets/svg/`.

## DaisyUI note

daisyUI is scoped to shadow DOM roots (see `style.css` `root:` config). Only these components are included: `button, toggle, input, select, radio, label, card, tabs, modal, divider, swap, fieldset, status, tooltip, badge, collapse, ring, avatar, indicator, list, loading, join, kbd, dropdown, menu`.

## Testing

Tests use Vitest with `jsdom` environment and global API. Run `npm test` (single pass) or `npm run test:watch` (watch mode). Test files: `tests/*.test.ts` (one file per feature or concern, about a hundred), with the chrome.storage mock in `tests/setup.ts`. Config: `vitest.config.ts`. `tests/no-html-injection.test.ts` fails on any `innerHTML` / `insertAdjacentHTML` / `outerHTML` in `src/`.

Browser-level: `node scripts/firefox-smoke.mjs <build>` (Firefox) and `--browser chrome` (Chrome, also run in CI) load a build into a real browser against a synthetic Intra page: docs/FIREFOX-TESTING.md.

## Extension mechanics

- Runs as a content script injected at `document_start` on `https://*.intra.42.fr/*`.
- Hooks `window.fetch` in `public/hook.js` to intercept `/locations_stats` for logtime data and the Intra token. It is declared in the manifests as a content script with `"world": "MAIN"` at `document_start` (Firefox 128+, Chrome 111+), so it runs before any page script; it is no longer injected with a `<script>` tag.
- Settings stored in `chrome.storage.local` via typed `getConfig()` helper (one snapshot per context, see `src/core/config/snapshot.ts`).
- Cloud sync (optional) talks to the worker with the session token from the Intra-token sign-in (see *Auth mode*). The worker keeps settings, published visuals, the calendar `.ics` and subject reports under a SHA-256 hash of the login; PRIVACY.md is the reference for what goes where.
- `src/background.ts` (built by `vite.background.config.ts`) does three things: the GitHub release check on a 6-hour alarm (badge + `UPDATE_AVAILABLE`, a plain CORS request, no host permission), fetching Intra pages cross-origin with the user's cookies for content scripts (`FT_FETCH_INTRA_PAGE`), and reloading the profile tabs after a login. No polling, no notifications.
- Host permissions are `*.intra.42.fr` and the worker only; the popup and the login button request exactly those with `chrome.permissions` (Firefox treats MV3 host permissions as optional).

## Worker (`../better-intra-worker`)

- **`BETTER_INTRA_KV`** — one JSON record per login hash (session tokens, settings), plus small caches (JWKS, project map). The namespace shares 1,000 writes a day on the free plan: never add a write on a hot path.
- **D1** (`better_intra_d1`) — `users` (login hash, country, first sign-in: the public stats), `calendar_ics`, subject tracker tables.
- Routes worth knowing: `/auth/intra` (sign-in), `/api/v1/private/settings` (GET/POST/DELETE, `?all=true` wipes), `/api/v1/public/visuals` (unauthenticated, by login hash), `/api/v1/public/stats`, `/api/v1/public/announcement`, `/gh/*` (GitHub proxy for campus and data files), `/api/v1/private/calendar/*`, `/api/v1/private/subjects/*`.
- Dormant unless a 42 application is configured (`CLIENT_ID`): OAuth `/login` + `/callback`, the evaluation and Discord handlers and every cron. Do not design against them.

### Commands

```bash
cd ../better-intra-worker
npm install
npm run dev       # wrangler dev
npm run deploy    # wrangler deploy --remote (only with explicit user consent)
```

## CI

- **Release drafter** — on push/PR to `main`; auto-categorizes commits into draft release.
- **Publish** — triggers on GitHub Release publish; builds Firefox (`.xpi`) and Chrome (`.zip`); signs Firefox via AMO for full releases.

## Languages (English and French)

- Every text a user sees or hears goes through `t()` from `src/core/i18n/i18n.ts`: the English text is the key, `src/core/i18n/fr/*.json` (one file per area) gives the French. `tp(n, one, other)` for counts, `msg()` for module-level constants (translated with `t()` where shown), `intlLocale()` for dates.
- The first argument is a string literal: the build (`scripts/i18n-catalog.ts`) keeps in each bundle only the translations whose English text it contains.
- `tests/i18n-catalog.test.ts` fails on a text without French, an unused entry or a lost `{placeholder}`. Tests run in English (`tests/setup.ts` stubs an en-US browser).
- The language is `UI_LANGUAGE` (Advanced tab: Auto / Français / English), read by `initI18n()` before anything renders. Never translate text matched against the Intra's own page.
- French style: tutoiement, U+00A0 before `: ; ! ?` and inside `« »`, apostrophe `’`.

## DOs and DON'Ts

- **NEVER use `innerHTML`** — lit-html is always available. Use `render(unsafeHTML(...), container)` from `lit-html` and `lit-html/directives/unsafe-html.js` instead.
- **NEVER commit without explicit user approval** — do not run `git commit`, amend, or push unless the user explicitly asks you to.

## NEVER deploy the worker without explicit user consent

## No linter; Prettier for formatting

Prettier is used for formatting (editor-level; no committed config). No ESLint or similar configured.
