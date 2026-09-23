# Privacy Policy for Better Intra (42 Mulhouse edition)

*Last updated: September 2026*

This policy describes the extension built from this repository and the server it talks to, the fork's own Cloudflare Worker at `https://betterintra-remake.maitox.workers.dev`. It is written from the code: every request the extension makes is listed below. Better Intra does not sell or share user data, and uses no analytics, tracking or advertising service.

## What stays on your device

All settings (logtime goals, colours, shortcuts, cluster preferences, profile visuals and look, public profile texts, friend list, feature toggles) live in `chrome.storage.local` on your device. Logtime, project, evaluation and achievement data is read from the Intra page you are looking at and never transmitted by the extension.

Other students' public visuals and looks are cached locally (under their login) for ten minutes so a profile you re-open shows them at once. Cached entries are cleared with *Reset* in the Settings Hub and when the extension is uninstalled.

The extension also keeps, on your device only: your worker session token once you sign in, the campus it detected, the dismissed announcement, the last update check result and the easter eggs you found. None of these is exported by *Backup* or sent to the cloud.

## Requests made without an account

Nothing is sent to the worker until you open an Intra page, and nothing identifies you until you sign in. Signed out, the extension makes these requests:

- **Other students' profiles.** When you open `/users/<login>`, the extension asks the worker for that student's public visuals and look at `/api/v1/public/visuals?login=<hash>`, where `<hash>` is the SHA-256 of the login you are viewing. The endpoint needs no authentication: anyone running Better Intra can read what a student chose to publish, and only that.
- **Campus and cluster data.** The list of campuses, the cluster maps and the event types come from this repository through the worker's `/gh/` proxy (a cache in front of GitHub). Cluster map images are fetched through the worker's `/api/v1/cluster/svg` endpoint.
- **Announcement.** Profile pages fetch `/api/v1/public/announcement` at most once every five minutes across all your tabs.
- **About tab.** Opening the About tab of the Settings Hub fetches the repository's star and follower counts from `api.github.com` and the community counters from the worker's `/api/v1/public/stats`.
- **Update check.** The background script asks `api.github.com` for the latest release when the extension is installed, when the browser starts and every 6 hours. The request carries no identifier, only the standard headers your browser sends.

What the Intra itself receives is unchanged: friends' level, wallet, location and picture come from `intrapy.intra.42.fr`, correction statistics and Thursday Roulette history are parsed from the v2 pages of `profile.intra.42.fr` and `projects.intra.42.fr`, and cluster occupancy from `meta.intra.42.fr`. Those requests are made with your own Intra session, as if you had opened the page, and never go through the worker.

## Signing in

*Connect with 42* in the popup reads the Intra session token the v3 pages already hold (a short-lived JWT issued by `auth.42.fr`) and POSTs it once to the worker's `/auth/intra`. The worker checks the signature against 42's published keys (the Keycloak JWKS), the issuer and the expiry, reads your login from it, and answers with a random session token. The Intra token is not stored anywhere; the worker keeps only a SHA-256 hash of your login and up to ten session tokens. The extension stores its session token in `chrome.storage.local`; *Disconnect* revokes it on the worker. A self-hosted build can use 42 OAuth instead (see docs/SELF-HOSTING.md); this deployment has no 42 application and that code path is never taken.

## What the cloud stores once you are signed in

Everything below is keyed under the hash of your login and only readable with one of your session tokens, except where noted.

- **Your settings**, when you push them (*Push* or auto-push in the hub footer). The pushed list is `CLOUD_SYNC_KEYS` in `src/core/config/keys.ts`: feature toggles, theme, logtime options, cluster preferences, profile visuals (image URLs, positions, histories), dashboard card order, shortcuts, the **friends list** (the logins you added), friends widget options, the Customize look (colours, fonts, custom CSS, presets), public profile texts and styles, and your **calendar subscription token**. Never pushed: your session token, the detected campus, caches, found easter eggs.
- **Public visuals and look** (`Visuals sync`, *Publish my look*, *Public profile*). The part of those settings you chose to publish is served to any Better Intra user who opens your profile, by login hash, through the unauthenticated `/api/v1/public/visuals`. Only presentation values and short texts are published; custom CSS, fonts and every other setting stay private. Clear a field or switch the publish toggles off to stop publishing.
- **Calendar sync.** Each time you open your own profile with a calendar link generated, your subscribed Intra events are pushed as an `.ics` file that the worker serves at your private link. *Regenerate* and *Wipe All Data* delete it.
- **Subject tracker** (*Share with the community*, on by default when signed in). When you open a project page, the subject PDF's URL and the project slug are reported to the worker so every user can see when a subject changed. Switch it off in the Extras tab to keep it local.
- **Friends' data.** The friends widget reads your friends' public visuals from the same `/api/v1/public/visuals` endpoint, by login hash; their status and stats come from `intrapy.intra.42.fr` with your own session. The friends list itself reaches the worker only as part of your pushed settings.
- **A users row** in the worker's database: your login hash, the country Cloudflare attributes to your connection when you first sign in, and the sign-in date. It feeds the public counters shown in the About tab (`/api/v1/public/stats`: total users, new users, users per country). No login, IP address or name is stored there.

## Server logs

The worker is a Cloudflare Worker with Workers Logs enabled. Every request is logged with its URL, method, status and timing, so the login hash in a query string (`?login=<hash>`) and the paths above appear in those logs. Logs are used to diagnose failures, never for analytics, and Cloudflare deletes them after its retention period (3 days on the free plan, 7 days on a paid plan). Request bodies (your settings, your Intra token) are not logged.

## Images other students chose

A custom avatar, banner or background is a URL the profile owner pasted, or an image they uploaded from the editor: the worker keeps one such image per field (avatar, banner, background) under the login hash and serves it publicly at `/img/<hash>/<field>`; a new upload replaces the previous one and *Wipe all data* deletes them. The extension loads it from wherever it is hosted (any http(s) URL). The host serving the image sees the request your browser makes for it (your IP address, as for any picture on a web page).

## Data retention and deletion

- **Local data**: cleared when you uninstall the extension or click *Reset* in the Settings Hub.
- **Cloud data**: *Wipe All Data* in the popup deletes your settings, session tokens, published visuals and look, calendar file and your users row. *Disconnect* only revokes the current session.
- **Server logs**: deleted by Cloudflare after the retention period above.

## Permissions

The manifests (`manifests/manifest.chrome.json`, `manifests/manifest.firefox.json`) ask for:

- `storage` — settings and caches in `chrome.storage.local`
- `alarms` — the 6-hour update check timer
- `activeTab` — signing in from the toolbar popup on the open Intra tab
- `https://*.intra.42.fr/*` — the extension only runs on the 42 Intra; the background script also reads Intra pages there with your cookies for the correction stats and roulette cards
- `https://betterintra-remake.maitox.workers.dev/*` — the fork's worker, for every cloud feature above

No permission is requested for `api.github.com`: the update check and the About tab reach it as ordinary cross-origin requests that GitHub allows from any origin.

## Changes to this policy

When this policy changes, the "Last updated" date at the top is updated in the same release.

## Contact

Questions and requests: open an issue at https://github.com/MaiToxx/BetterIntraRemake/issues.
