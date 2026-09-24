# Privacy Policy for Better Intra (42 Mulhouse edition)

*Last updated: September 2026*

This policy describes the extension built from this repository and the server it talks to, the fork's own Cloudflare Worker at `https://betterintra-remake.maitox.workers.dev`. It is written from the code: every request the extension makes is listed below. Better Intra does not sell or share user data, and uses no analytics, tracking or advertising service.

## What stays on your device

All settings (logtime goals, colours, shortcuts, cluster preferences, profile visuals and look, public profile texts, friend list, feature toggles) live in `chrome.storage.local` on your device. Logtime, project, evaluation and achievement data is read from the Intra page you are looking at and never transmitted by the extension.

Other students' public visuals and looks are cached locally (under their login) so a profile you re-open shows them at once: a copy less than ten minutes old is used as it is, an older one is shown and checked with the worker again. A copy not refreshed for 30 days is deleted (at most 200 are kept), and all of them are cleared with *Reset* in the Settings Hub and when the extension is uninstalled.

The extension also keeps, on your device only: your worker session token once you sign in, the dismissed announcement, the last update check result and the cache of other students' visuals. None of these is exported by *Backup* or sent to the cloud.

A *Backup* file holds every setting except the session, the calendar link and the friends' data cache. It therefore includes the campus the extension detected, the easter eggs you found and the subject tracker's local state (never sent to the cloud, see below), and restoring the file brings them back.

## Requests made without an account

Nothing is sent to the worker until you open an Intra page, and nothing identifies you until you sign in. Every request to the worker reaches Cloudflare, which runs it, with your IP address, as for any website; the worker does not store it. Signed out, the extension makes these requests:

- **Other students' profiles.** When you open `/users/<login>`, the extension asks the worker for that student's public visuals and look at `/api/v1/public/visuals?login=<hash>`, where `<hash>` is the SHA-256 of the login you are viewing. The endpoint needs no authentication: anyone running Better Intra can read what a student chose to publish, and only that.
- **Campus and cluster data.** The list of campuses, the cluster maps and the event types come from this repository through the worker's `/gh/` proxy (a cache in front of GitHub). Cluster map images are fetched through the worker's `/api/v1/cluster/svg` endpoint.
- **Announcement.** Profile pages fetch `/api/v1/public/announcement` at most once every five minutes across all your tabs.
- **About tab.** Opening the About tab of the Settings Hub fetches the community counters from the worker's `/api/v1/public/stats`.
- **Update check** (not in the Chrome Web Store build, which Chrome updates itself). The background script asks `api.github.com` for the latest release when the extension is installed, when the browser starts and every 6 hours. The request carries no identifier, only the standard headers your browser sends.
- **Shortcut icons.** For each shortcut without an emoji, the extension loads that site's `/favicon.ico` and, if there is none, `https://icons.duckduckgo.com/ip3/<hostname>.ico`, without a referrer. Both see your IP address, and DuckDuckGo learns the shortcut's hostname. Give a shortcut an emoji to avoid these requests.

What the Intra itself receives is unchanged: friends' level, wallet, location and picture come from `intrapy.intra.42.fr`, correction statistics and Thursday Roulette history are parsed from the v2 pages of `profile.intra.42.fr` and `projects.intra.42.fr`, and cluster occupancy from `meta.intra.42.fr`. Those requests are made with your own Intra session, as if you had opened the page, and never go through the worker.

## Signing in

Before the first sign-in the extension shows what signing in sends and where, and waits for an explicit *Sign in*. *Sign in with 42* (popup or hub) reads the Intra session token the v3 pages already hold (a short-lived JWT issued by `auth.42.fr`) and POSTs it once to the worker's `/auth/intra`. The worker checks the signature against 42's published keys (the Keycloak JWKS), the issuer and the expiry, reads your login from it, and answers with a random session token. The Intra token is not stored anywhere; the worker keeps only a SHA-256 hash of your login and up to ten session tokens. The extension stores its session token in `chrome.storage.local`; *Sign out* revokes it on the worker. A self-hosted build can use 42 OAuth instead (see docs/SELF-HOSTING.md); this deployment has no 42 application and that code path is never taken.

## What the cloud stores once you are signed in

Everything below is keyed under the hash of your login and only readable with one of your session tokens, except where noted.

- **Your settings**, when you push them (*Push* or auto-push in the hub footer). The pushed list is `CLOUD_SYNC_KEYS` in `src/core/config/keys.ts`: feature toggles, theme, logtime options, cluster preferences, profile visuals (image URLs, positions, histories), dashboard card order, shortcuts, the **friends list** (the logins you added), friends widget options, the Customize look (colours, fonts, custom CSS, presets), public profile texts and styles, the campus the extension detected, and your **calendar subscription token** with a hash of the last calendar pushed. Never pushed: your session token, the friends' data cache, the subject tracker's local state, the easter eggs you found, your subject tracker choices and the Manual/Auto push setting. Some changes are pushed at once, even in Manual mode: adding or removing a friend, and a change to something visitors see (your published look, public profile texts and styles, the publish switches), push the whole list above; *Save* in the profile visuals editor uploads the visuals alone, and *Stop sharing* in the Calendar tab only empties the calendar token and hash in the cloud copy.
- **Public visuals and look** (profile visuals, *Publish my look*, *Public profile*). The part of those settings you chose to publish is served to any Better Intra user who opens your profile, by login hash, through the unauthenticated `/api/v1/public/visuals`. Your profile visuals (avatar, banner and background images with their modes, colours and positions, the avatar decoration and badge colour) and your Logtime display values (calendar colour, labels colour, emoji, emoji value and rainbow colours) are published whenever you push, with no switch of their own: that is how visitors see your profile and calendar the way you set them. The per-hour rate of the emoji count is not published: visitors count with their own. Since 1.14.0 *Publish my look* is on by default: your theme preset, accent, palette, background and card styles are published once you connect, unless you switch it off (an account that never touched the switch pushes once after the update so the new default takes effect). Only presentation values and short texts are published; custom CSS, fonts and every other setting stay private. Clear a field or switch the publish toggles off to stop publishing.
- **Calendar sync.** Each time you open your own profile with a calendar link generated, your subscribed Intra events are pushed as an `.ics` file that the worker serves at your private link. *Regenerate* retires the old link (the file is then served at the new link only, and the extension uploads a fresh copy at once); *Stop sharing* (Calendar tab) revokes the link and deletes the file, and so does *Wipe All Data*.
- **Subject tracker** (*Share with the community*, on by default when signed in). When you open a project page (at most once every 15 minutes per project), the project slug is sent to the worker, with the subject PDF's URL the first time the project is seen or when its link changed, so every user can see when a subject changed. Switch it off in the Extras tab to keep it local.
- **Friends' data.** The friends widget reads your friends' public visuals from the same `/api/v1/public/visuals` endpoint, by login hash; their status and stats come from `intrapy.intra.42.fr` with your own session. The friends list itself reaches the worker only as part of your pushed settings.
- **A users row** in the worker's database: your login hash and the date of your first sign-in. It feeds the public counters shown in the About tab (`/api/v1/public/stats`: total users, new users). No login, IP address, country or name is stored there (before 1.14.0 the row also held the country of the first sign-in; those values are being cleared).

## Server logs

The worker is a Cloudflare Worker with Workers Logs on and per-request invocation logs off, so requests are not logged one by one. When something fails, the worker logs an error line with the request's method and path (never its query string, so never the `?login=<hash>` of a request), and Cloudflare adds its own metadata to that line. Logs are used to diagnose failures, never for analytics, and Cloudflare deletes them after its retention period (3 days on the free plan, 7 days on a paid plan). Request bodies (your settings, your Intra token) are not logged.

## Images other students chose

A custom avatar, banner or background is a URL the profile owner pasted, or an image they uploaded from the editor. Uploads leave the browser only when you press *Save*; the worker removes the location, date and camera metadata (EXIF, XMP, text chunks; only a JPEG's orientation is kept) before storing it, keeps one image per field (avatar, banner, background) under the login hash, and serves it publicly at `/img/<hash>/<field>`. A new upload replaces the previous one; clearing the field, pasting a link over it or *Reset* deletes it from the worker, and so does *Wipe all data*. The extension loads it from wherever it is hosted (any http(s) URL). The host serving the image sees the request your browser makes for it (your IP address, as for any picture on a web page).

## Data retention and deletion

- **Local data**: cleared when you uninstall the extension or click *Reset* in the Settings Hub.
- **Cloud data**: *Wipe All Data* in the popup deletes your settings, session tokens, published visuals and look, calendar file and your users row. *Stop sharing* in the Calendar tab deletes the calendar file alone and revokes its link. *Sign out* only revokes the current session.
- **Server logs**: deleted by Cloudflare after the retention period above.

## Permissions

The manifests (`manifests/manifest.chrome.json`, `manifests/manifest.firefox.json`) ask for:

- `storage` — settings and caches in `chrome.storage.local`
- `alarms` — the 6-hour update check timer (not in the Chrome Web Store build, which has no update check)
- `activeTab` (Firefox only) — lets the toolbar popup see that the open tab is an Intra page when site access has not been granted yet
- `https://*.intra.42.fr/*` — the extension only runs on the 42 Intra; the background script also reads Intra pages there with your cookies for the correction stats and roulette cards
- `https://betterintra-remake.maitox.workers.dev/*` — the fork's worker, for every cloud feature above

No permission is requested for `api.github.com`: the update check reaches it as an ordinary cross-origin request that GitHub allows from any origin.

Firefox also shows, when you install the add-on, what it sends out of the browser. `manifests/manifest.firefox.json` declares it in `data_collection_permissions`, every category as required, since the profile lookups above start before any sign-in:

- `browsingActivity` — the login hash of each Intra profile you open and, signed in with the subject tracker on, the project pages you open
- `authenticationInfo` — the Intra session token sent once at sign-in, and the worker's session token
- `personallyIdentifyingInfo` — the hash of your login, which keys everything stored and each profile lookup; the Intra session token, which carries your login; the logins of your friends list, inside pushed settings
- `websiteContent` — pushed settings, public profile texts and look, uploaded images, the Intra events of the calendar feed, subject PDF addresses

## Changes to this policy

When this policy changes, the "Last updated" date at the top is updated in the same release.

## Contact

Questions and requests: open an issue at https://github.com/MaiToxx/BetterIntraRemake/issues.
