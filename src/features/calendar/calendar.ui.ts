import { html, render } from "lit-html";
import { ref } from "lit-html/directives/ref.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { clearAuthFailed, loginWith42 } from "../account/account.ts";
import { generateQrDataUrl } from "./qr.ts";
import { maybeSyncCalendar } from "./calendar-sync.ts";
import CALENDAR_PLUS_SVG from "../../assets/svg/calendar-plus.svg?raw";
import COPY_SVG from "../../assets/svg/copy.svg?raw";

import { WORKER_URL, workerFetch } from "../../core/worker.ts";
import { msg, t } from "../../core/i18n/i18n.ts";
const TOKEN_KEY = "CALENDAR_SYNC_TOKEN";

/** msg(): shown with t(REGENERATE_CONFIRM) (module code runs before the language is known). */
export const REGENERATE_CONFIRM = msg(
  "Create a new calendar link? Calendars subscribed to the current link stop updating until you subscribe them to the new one.",
);

function calUrl(token: string): string {
  return `https://${WORKER_URL.replace("https://", "")}/calendar/${token}.ics`;
}

/** The same feed for the calendar app of the system (Apple Calendar, Outlook...). */
export function webcalUrl(token: string): string {
  return calUrl(token).replace(/^https:/, "webcal:");
}

/** Google Calendar's "add by URL" page with the feed already filled in. */
export function googleCalendarUrl(token: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(token))}`;
}

/** What a failed link request tells the student, by status (0: no answer). */
export function generateError(status: number): string {
  if (status === 401) return t("Your Better Intra session has expired. Sign in again to create the link.");
  if (status === 429) return t("Too many requests in a row. Wait a minute and try again.");
  if (status === 0) return t("Could not reach the server. Try again.");
  return t("The server could not create the link (error {status}). Try again later.", { status });
}

export function renderCalendarPanel() {
  return html`<div ${ref(renderPanel)} class="col-span-full"></div>`;
}

/**
 * The panel is always the whole card: an outcome (a failed request, the
 * sign-in it needs) is a line inside it. Rendering the message alone used to
 * replace the card, its button included, with no way back but a page reload.
 */
function renderPanel(el: Element | undefined) {
  if (!el) return;
  const container = el as HTMLElement;
  let error: string | null = null;
  /** The last request answered 401: the sign-in button comes back. */
  let sessionExpired = false;
  let copied = false;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = () =>
    loginWith42(async () => {
      await clearAuthFailed();
      window.location.reload();
    });

  const update = async () => {
    const store = await chrome.storage.local.get([
      TOKEN_KEY,
      "CLOUD_TOKEN",
      "CLOUD_LOGIN",
    ]);
    const token = store[TOKEN_KEY] as string | undefined;
    const signedIn = !!store.CLOUD_TOKEN && !!store.CLOUD_LOGIN;

    const qrUrl = token
      ? `https://${WORKER_URL.replace("https://", "")}/calendar/${token}.ics`
      : "";
    const qrDataUrl = token ? generateQrDataUrl(qrUrl, 200) : "";

    render(
      html`
        <div
          class="card bg-base-200 shadow-sm w-full"
          style="border: 2px solid var(--color-info)"
        >
          <div class="card-body p-4 sm:p-6 gap-4">
            <h3 class="card-title text-lg">${t("Calendar Sync")}</h3>
            <p class="text-sm opacity-70">
              ${t(
                "Subscribe to the 42 events you are registered for in any calendar app. The feed updates every time you visit your profile.",
              )}
            </p>

            ${error
              ? html`<p class="text-sm text-error" role="alert">${error}</p>`
              : ""}
            ${sessionExpired
              ? html`<button
                  type="button"
                  class="btn btn-primary btn-sm self-start"
                  @click="${connect}"
                >
                  ${t("Sign in again")}
                </button>`
              : ""}
            ${!signedIn && !token
              ? html`
                  <p class="text-sm opacity-70">
                    ${t("Sign in with your 42 account to generate a calendar link.")}
                  </p>
                  <button
                    type="button"
                    class="btn btn-primary btn-sm self-start"
                    @click="${connect}"
                  >
                    ${t("Sign in with 42")}
                  </button>
                `
              : token
              ? html`
                  <div
                    class="bg-base-100 rounded-lg p-3 flex items-center gap-2"
                    style="border: 2px solid var(--color-info)"
                  >
                    <code class="text-xs flex-1 break-all select-all"
                      >${calUrl(token)}</code
                    >
                    <button
                      type="button"
                      class="btn btn-sm btn-square"
                      @click="${() => copyLink(calUrl(token))}"
                      data-tip="${t(copied ? "Copied!" : "Copy link")}"
                      aria-label="${t(copied ? "Link copied" : "Copy link")}"
                    >
                      <span class="size-4 flex items-center justify-center"
                        >${unsafeHTML(COPY_SVG)}</span
                      >
                    </button>
                  </div>
                  <span class="sr-only" role="status"
                    >${copied ? t("Link copied") : ""}</span
                  >

                  <div class="flex flex-wrap gap-2">
                    <a class="btn btn-sm btn-primary" href="${webcalUrl(token)}"
                      >${t("Open in my calendar app")}</a
                    >
                    <a
                      class="btn btn-sm"
                      style="border: 2px solid var(--color-info)"
                      href="${googleCalendarUrl(token)}"
                      target="_blank"
                      rel="noopener noreferrer"
                      >${t("Add to Google Calendar")}</a
                    >
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div
                      class="bg-base-100 rounded-lg p-2.5"
                      style="border: 2px solid var(--color-info)"
                    >
                      <span class="font-semibold">${t("Apple Calendar")}</span>
                      <p class="opacity-60 mt-0.5">
                        ${t("Scan the QR code or File → New")}
                      </p>
                    </div>
                    <div
                      class="bg-base-100 rounded-lg p-2.5"
                      style="border: 2px solid var(--color-info)"
                    >
                      <span class="font-semibold">${t("Google Calendar")}</span>
                      <p class="opacity-60 mt-0.5">${t("Settings → Add → From URL")}</p>
                    </div>
                    <div
                      class="bg-base-100 rounded-lg p-2.5"
                      style="border: 2px solid var(--color-info)"
                    >
                      <span class="font-semibold">Outlook</span>
                      <p class="opacity-60 mt-0.5">${t("Add calendar → Subscribe")}</p>
                    </div>
                  </div>

                  <div class="flex justify-center pt-1">
                    <img
                      src="${qrDataUrl}"
                      alt="${t("QR Code")}"
                      class="rounded-lg"
                      width="200"
                      height="200"
                    />
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="btn btn-sm"
                      style="border: 2px solid var(--color-info)"
                      @click="${handleRegenerate}"
                    >
                      <span class="size-4 flex items-center justify-center"
                        >${unsafeHTML(CALENDAR_PLUS_SVG)}</span
                      >
                      ${t("Regenerate")}
                    </button>
                    <span class="text-xs opacity-50 ml-1"
                      >${t("New link invalidates the old one")}</span
                    >
                  </div>
                `
              : html`
                  <button
                    class="btn btn-primary btn-sm"
                    @click="${handleGenerate}"
                  >
                    <span class="size-4 flex items-center justify-center"
                      >${unsafeHTML(CALENDAR_PLUS_SVG)}</span
                    >
                    ${t("Generate calendar link")}
                  </button>
                `}
          </div>
        </div>
      `,
      container,
    );
  };

  // The copy used to give no sign of success and did nothing when the
  // clipboard was refused (no focus, a strict browser): the link is then
  // offered in a prompt, like the theme code.
  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt(t("Copy your calendar link:"), url);
      return;
    }
    copied = true;
    await update();
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied = false;
      void update();
    }, 2000);
  };

  // One click used to revoke the link: every phone or Google calendar
  // subscribed to it stopped updating, without a word.
  const handleRegenerate = () => {
    if (!window.confirm(t(REGENERATE_CONFIRM))) return;
    void handleGenerate();
  };

  const handleGenerate = async () => {
    const store = await chrome.storage.local.get([
      "CLOUD_TOKEN",
      "CLOUD_LOGIN",
    ]);
    const sessionToken = String(store.CLOUD_TOKEN || "");
    const cloudLogin = String(store.CLOUD_LOGIN || "");
    if (!sessionToken || !cloudLogin) {
      error = t("Sign in to Better Intra first (Sign in with 42 in the footer).");
      await update();
      return;
    }

    const uuid = crypto.randomUUID();
    // workerFetch, not a bare fetch: a 401 flags CLOUD_AUTH_FAILED (the
    // hub's "Reconnect"), and every failure used to read "Could not reach
    // the server", an expired session and a rate limit included.
    const res = await workerFetch("/api/v1/private/calendar/token", {
      method: "POST",
      body: { token: uuid },
      auth: { login: cloudLogin, token: sessionToken },
    });
    if (!res.ok) {
      // the existing link, QR and button stay: the message sits above them
      sessionExpired = res.status === 401;
      error = generateError(res.status);
      await update();
      return;
    }
    await chrome.storage.local.set({ [TOKEN_KEY]: uuid });
    error = null;
    sessionExpired = false;
    await update();
    // fill the new feed now rather than at the next profile visit
    void maybeSyncCalendar();
  };

  update();
}
