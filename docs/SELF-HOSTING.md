# Self-hosting the cloud worker

Better Intra's cloud features (sign-in, settings sync, custom profile visuals
shared with other users, cluster map proxy, calendar sync, subject tracker)
talk to a Cloudflare Worker. This edition uses
`https://betterintra-remake.maitox.workers.dev`. If that instance is down or
you want to own your users' data, deploy your own and point the extension at it.

Everything the extension needs is driven by **one setting**:
`package.json` → `config.workerUrl`. The build injects it into the code, the
manifests' host permissions and the callback content script match pattern.

> Switching worker means a fresh cloud account for every user: sessions,
> synced settings and shared visuals live in the worker's storage and are not
> migrated. Users simply click *Connect with 42* again.

The public visuals endpoint (`/api/v1/public/visuals`) also returns a `look`
object when the user turned on *Publish my look on my profile*: the subset of
their Customize settings listed in `PUBLIC_LOOK_KEYS` (worker
`src/handlers/settings.ts`, extension `src/features/customize/public-look.ts`).
The extension validates every value again before applying it.

Those two key lists are kept in sync by hand. Each repository pins the list
in a test (`tests/extras-contract.test.ts` here, `tests/settings.test.ts` in
the worker), so adding a public setting fails both suites until the worker is
updated and redeployed.

## Without a 42 OAuth application: "intra" auth mode

Creating a 42 API application requires student status (pisciners get
"YOU ARE NOT ALLOWED TO CREATE A NEW APP"). The fork of the worker at
[MaiToxx/BetterIntraRemake-worker](https://github.com/MaiToxx/BetterIntraRemake-worker)
adds `POST /auth/intra`: the extension sends the Keycloak session token the
Intra v3 front-end already uses, the worker verifies its signature against
`auth.42.fr`'s public keys and opens a session for that login. No popup, no
redirect, no application to register. Enable it in `package.json`:

```json
"config": {
  "workerUrl": "https://<your-worker-url>",
  "authMode": "intra"
}
```

What needs a 42 application stays out of this edition: evaluation reminders
and Discord, the students directory, outstanding stars, logtime history beyond
what the Intra page provides. Since 1.13.0 the worker fork no longer carries
those routes at all: they answered 404 or errors on a deployment without an
application, so they were removed with their crons, D1 tables and secrets. What
the worker does today is listed in its README (`Routes`, `Limits`, `Data kept
in D1`).

Friends' live data is rebuilt from the Intra's own API by the extension
(src/features/friends/friends-intra.ts); correction stats and Thursday Roulette
history are rebuilt from the Intra v2 pages
(src/features/profile/cards/profile-stats-intra.ts). Settings sync, shared
profile visuals, cluster map proxy, announcements, subject tracker and calendar
sync work.

## 1. What you need

- A **Cloudflare** account (the free plan is enough: Workers, KV, D1 and the
  rate limit bindings).
- **Node.js** and `npx wrangler` (installed by the worker's `npm install`).

No 42 application, no R2 bucket, no Discord bot.

## 2. Get the worker code

```bash
git clone https://github.com/MaiToxx/BetterIntraRemake-worker.git
cd better-intra-worker
npm install
npx wrangler login
```

The campus/data proxy (`src/handlers/gh-proxy.ts`, `SOURCES`) points at this
extension repository; change it if you fork the campus files too.

## 3. Create the storage resources

```bash
npx wrangler kv namespace create BETTER_INTRA_KV
npx wrangler d1 create better-intra-d1
npx wrangler d1 execute better-intra-d1 --remote --file=schema.sql
```

Each command prints an id. Edit `wrangler.json`:

- `name`: e.g. `better-intra-42campus` (becomes the URL `https://better-intra-42campus.<account>.workers.dev`)
- `kv_namespaces[0].id`: the KV id
- `d1_databases[0].database_id`: the D1 id
- `ratelimits`: keep as is (the namespace ids only need to be unique inside
  your account)

## 4. Secrets

Only one, and it is optional:

```bash
npx wrangler secret put ANNOUNCEMENT_SECRET     # lets you publish banners to all users
```

## 5. Deploy and check

```bash
npx wrangler deploy
curl https://<your-worker-url>/api/v1/public/stats
```

The stats endpoint must answer JSON.

## 6. Point the extension at it

In this repository, edit `package.json`:

```json
"config": {
  "workerUrl": "https://<your-worker-url>",
  "authMode": "intra"
}
```

Build (`npm run build:firefox` / `npm run build:chrome`) or publish a release:
the manifests and every API call now target your worker. Users install that
build and click *Connect with 42* once.

## Notes

- Logins are stored hashed (SHA-256). The worker never sees a 42 API token:
  the Intra session JWT is verified once against `auth.42.fr`'s public keys
  and only a random session token is kept.
- Limits (rate limits, size caps, what "Wipe all data" deletes) are documented
  in the worker's README and in PRIVACY.md.
- Deploying is `npx wrangler deploy` from your machine; there is no CI
  pipeline in the worker repository.
