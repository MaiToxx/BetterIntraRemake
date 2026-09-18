# Self-hosting the cloud worker

Better Intra's cloud features (42 login, settings sync, custom profile visuals
shared with other users, live cluster occupancy proxy, evaluations / Discord
reminders, students directory, logtime history) talk to a Cloudflare Worker.
By default the extension uses the upstream instance at
`https://api.betterintra.com`, operated by the upstream maintainer. If that
instance is down or you want to own your users' data, deploy your own and point
the extension at it.

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

What still needs a 42 application (and stays unavailable in this mode):
evaluation reminders / Discord, students directory, logtime history beyond
what the Intra page provides, outstanding
stars. Friends' live data is rebuilt from the Intra's own API by the extension (src/features/friends/friends-intra.ts); correction stats and Thursday Roulette history are rebuilt from the Intra v2 pages (src/features/profile/profile-stats-intra.ts). Settings sync, shared profile visuals, cluster
map proxy, announcements, subject tracker and calendar sync work.

With this mode, steps 1 and 4 below only need the storage resources and the
`TOKEN_ENCRYPTION_KEY` secret; `CLIENT_ID` / `CLIENT_SECRET` can stay unset.

## 1. What you need

- A **Cloudflare** account (free plan is enough: Workers, KV, D1, cron triggers).
  R2 (image upload feature) requires a payment method on file even on the free tier;
  the feature is optional, see step 3.
- **Node.js** and `npx wrangler` (installed by the worker's `npm install`).
- A **42 OAuth application**: https://profile.intra.42.fr/oauth/applications/new
  - Name: anything (e.g. `Better Intra <campus>`)
  - Redirect URI: `https://<your-worker-url>/callback` (you get the URL at step 5;
    you can create the app first and edit the URI afterwards)
  - Scopes: `public`
  - Keep the **UID** (this is `CLIENT_ID`) and the **SECRET** (`CLIENT_SECRET`).

## 2. Get the worker code

```bash
git clone https://github.com/nicopasla/better-intra-worker.git
cd better-intra-worker
npm install
npx wrangler login
```

Point the campus/data proxy at this extension repository so cluster
definitions and event types come from the fork: in `src/handlers/gh-proxy.ts`
replace `nicopasla/better-intra` by `MaiToxx/BetterIntraRemake` in `SOURCES`.

## 3. Create the storage resources

```bash
npx wrangler kv namespace create BETTER_INTRA_KV
npx wrangler d1 create better-intra-d1
npx wrangler d1 execute better-intra-d1 --remote --file=schema.sql
npx wrangler r2 bucket create better-intra-images   # optional, image upload
```

Each command prints an id. Edit `wrangler.json`:

- `name`: e.g. `better-intra-42campus` (becomes the URL `https://better-intra-42campus.<account>.workers.dev`)
- `kv_namespaces[0].id`: the KV id
- `d1_databases[0].database_id`: the D1 id
- `vars.CLIENT_ID`: the UID of your 42 application
- `vars.DISCORD_ENABLED`: `"false"` unless you also set up a Discord bot; remove `DISCORD_CLIENT_ID` / `DISCORD_GUILD_ID`
- if you skipped R2: delete the `r2_buckets` block (the image upload endpoint will answer an error, everything else works)

## 4. Secrets

```bash
npx wrangler secret put CLIENT_SECRET          # the 42 application secret
npx wrangler secret put TOKEN_ENCRYPTION_KEY   # 32 random bytes, base64: openssl rand -base64 32
```

Optional, only if you use the matching features:

```bash
npx wrangler secret put PROXY_SECRET            # protects the private proxy / students refresh endpoints
npx wrangler secret put ANNOUNCEMENT_SECRET     # lets you publish banners to all users
npx wrangler secret put PROJECT_REFRESH_SECRET  # manual refresh of the project list
npx wrangler secret put DISCORD_BOT_TOKEN       # Discord reminders
npx wrangler secret put DISCORD_CLIENT_SECRET
```

## 5. Deploy and check

```bash
npm run deploy
curl https://<your-worker-url>/api/v1/public/stats
```

The stats endpoint must answer JSON. Then set the 42 application's redirect URI
to `https://<your-worker-url>/callback` if you had not already.

## 6. Point the extension at it

In this repository, edit `package.json`:

```json
"config": {
  "workerUrl": "https://<your-worker-url>"
}
```

Build (`npm run build:firefox` / `npm run build:chrome`) or publish a release:
the manifests, the login flow and every API call now target your worker. Users
install that build and click *Connect with 42* once.

## Notes

- Logins are stored hashed (SHA-256) and 42 tokens encrypted (AES-GCM with
  `TOKEN_ENCRYPTION_KEY`), the same way as upstream.
- The three cron triggers (evaluation reminders, project refresh, cleanup) are
  in `wrangler.json`; the free plan allows them.
- The students directory endpoints are written for the Belgium campus
  (campus id 12) upstream; they are harmless elsewhere.
- Upstream's own deployment pipeline is GitHub Actions with the Cloudflare
  API token as a secret; `npm run deploy` from your machine is enough to start.
