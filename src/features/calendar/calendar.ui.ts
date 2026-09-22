import { html, render } from "lit-html";
import { ref } from "lit-html/directives/ref.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { hashLogin } from "../../core/crypto.ts";
import { clearAuthFailed, loginWith42 } from "../account/account.ts";
import { generateQrDataUrl } from "./qr.ts";
import CALENDAR_PLUS_SVG from "../../assets/svg/calendar-plus.svg?raw";
import COPY_SVG from "../../assets/svg/copy.svg?raw";

import { WORKER_URL } from "../../core/worker.ts";
const TOKEN_KEY = "CALENDAR_SYNC_TOKEN";

function calUrl(token: string): string {
  return `https://${WORKER_URL.replace("https://", "")}/calendar/${token}.ics`;
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
            <h3 class="card-title text-lg">Calendar Sync</h3>
            <p class="text-sm opacity-70">
              Subscribe to your upcoming 42 events in any calendar app. Your
              calendar auto-syncs every time you visit your profile.
            </p>

            ${error
              ? html`<p class="text-sm text-error" role="alert">${error}</p>`
              : ""}
            ${!signedIn && !token
              ? html`
                  <p class="text-sm opacity-70">
                    Connect your 42 account to generate a calendar link.
                  </p>
                  <button
                    type="button"
                    class="btn btn-primary btn-sm self-start"
                    @click="${connect}"
                  >
                    Connect with 42
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
                      class="btn btn-sm btn-square"
                      @click="${async () => {
                        await navigator.clipboard.writeText(calUrl(token));
                      }}"
                      data-tip="Copy link"
                    >
                      <span class="size-4 flex items-center justify-center"
                        >${unsafeHTML(COPY_SVG)}</span
                      >
                    </button>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div
                      class="bg-base-100 rounded-lg p-2.5"
                      style="border: 2px solid var(--color-info)"
                    >
                      <span class="font-semibold">Apple Calendar</span>
                      <p class="opacity-60 mt-0.5">
                        Scan the QR code or File → New
                      </p>
                    </div>
                    <div
                      class="bg-base-100 rounded-lg p-2.5"
                      style="border: 2px solid var(--color-info)"
                    >
                      <span class="font-semibold">Google Calendar</span>
                      <p class="opacity-60 mt-0.5">Settings → Add → From URL</p>
                    </div>
                    <div
                      class="bg-base-100 rounded-lg p-2.5"
                      style="border: 2px solid var(--color-info)"
                    >
                      <span class="font-semibold">Outlook</span>
                      <p class="opacity-60 mt-0.5">Add calendar → Subscribe</p>
                    </div>
                  </div>

                  <div class="flex justify-center pt-1">
                    <img
                      src="${qrDataUrl}"
                      alt="QR Code"
                      class="rounded-lg"
                      width="200"
                      height="200"
                    />
                  </div>

                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      class="btn btn-sm"
                      style="border: 2px solid var(--color-info)"
                      @click="${handleGenerate}"
                    >
                      <span class="size-4 flex items-center justify-center"
                        >${unsafeHTML(CALENDAR_PLUS_SVG)}</span
                      >
                      Regenerate
                    </button>
                    <span class="text-xs opacity-50 ml-1"
                      >New link invalidates the old one</span
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
                    Generate calendar link
                  </button>
                `}
          </div>
        </div>
      `,
      container,
    );
  };

  const handleGenerate = async () => {
    const store = await chrome.storage.local.get([
      "CLOUD_TOKEN",
      "CLOUD_LOGIN",
    ]);
    const sessionToken = String(store.CLOUD_TOKEN || "");
    const cloudLogin = String(store.CLOUD_LOGIN || "");
    if (!sessionToken || !cloudLogin) {
      error = "Sign in to Better Intra first (Connect with 42 in the footer).";
      await update();
      return;
    }

    const uuid = crypto.randomUUID();
    const hashed = await hashLogin(cloudLogin);

    try {
      const res = await fetch(
        `${WORKER_URL}/api/v1/private/calendar/token?login=${encodeURIComponent(hashed)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ token: uuid }),
        },
      );
      if (!res.ok) throw new Error("Failed to register token");
      await chrome.storage.local.set({ [TOKEN_KEY]: uuid });
      error = null;
      await update();
    } catch {
      // the existing link, QR and button stay: the message sits above them
      error = "Could not reach the server. Try again.";
      await update();
    }
  };

  update();
}
