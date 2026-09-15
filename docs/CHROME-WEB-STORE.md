# Automatic updates on Chrome (Windows / macOS): the Chrome Web Store

Chrome on Windows and macOS only auto-updates extensions that come from the
Chrome Web Store. An unpacked build (*Load unpacked*) or a self-hosted `.crx`
never updates itself there (`CRX_REQUIRED_PROOF_MISSING`). On Linux the
self-hosted `.crx` + `updates.xml` route works; on Firefox, `updates.json`
already does the job.

The release workflow can publish every release to the Web Store by itself.
It needs a developer account and four repository secrets, once.

## 1. Developer account (one-time, 5 USD)

1. Sign in at https://chrome.google.com/webstore/devconsole with a Google
   account and pay the one-time registration fee.
2. *New item* → upload `better-intra-chrome.zip` from the latest GitHub
   release (any build works for the first upload; later ones are automated).
3. Fill the listing: name, description (`npm run generate:description` prints
   one from the README), category *Productivity*, language, screenshots
   (`npm run generate:store-images` renders them from `images/`), privacy
   policy URL (the README's *Privacy* section is enough), and the
   permissions justification:
   - `storage`: settings
   - `alarms`: periodic update check and cloud sync
   - `activeTab`: login from the toolbar popup
   - host permissions on `*.intra.42.fr` and the worker: the extension only
     works on the 42 intranet and talks to its own cloud worker
4. Submit for review. The first review takes from a few hours to a few
   days. Note the **extension id** shown in the dashboard (32 letters).

The Web Store id is not the same as the unpacked or `.crx` id: users switch
by installing from the store once (cloud sync brings their settings back).

## 2. API credentials (one-time)

Follow https://github.com/fregante/chrome-webstore-upload-keys (5 minutes):
it walks through creating a Google Cloud project, enabling the *Chrome Web
Store API*, creating an OAuth client and obtaining a **refresh token**.

## 3. Repository secrets

In the GitHub repository → *Settings* → *Secrets and variables* → *Actions*:

| Secret               | Value                                    |
| -------------------- | ---------------------------------------- |
| `CWS_EXTENSION_ID`   | the id from the developer dashboard      |
| `CWS_CLIENT_ID`      | OAuth client id                          |
| `CWS_CLIENT_SECRET`  | OAuth client secret                      |
| `CWS_REFRESH_TOKEN`  | refresh token                            |

From then on, publishing a GitHub release also builds a store variant
(`npm run build:chrome-store`, same code without the self-hosted
`update_url`) and uploads it with *auto-publish*. Each version still goes
through Google's review before it reaches users, usually within a day; Chrome
then installs it by itself within a few hours.

## Firefox

Nothing to do: the signed `.xpi` and `updates.json` are already automatic.
Firefox checks once a day; *about:addons* → gear → *Check for Updates*
forces it.
