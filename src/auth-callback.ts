/**
 * Content script for https://api.betterintra.com/callback* (the worker's
 * "Login Successful! Transferring credentials..." page).
 *
 * That page relies entirely on `window.opener.postMessage(...)`. When the
 * login was started from the toolbar popup, Chrome/Firefox close the popup as
 * soon as the auth window opens, so there is no opener any more and the page
 * stays on "Transferring credentials..." forever. This script reads the
 * credentials the page was about to post, stores them itself (only if this
 * extension started a login recently, see auth-callback.ts) and closes the
 * window. The regular opener path keeps working unchanged; storing the same
 * values twice is harmless.
 *
 * Every outcome is made visible on the page: a silent failure looks exactly
 * like the original bug and cannot be diagnosed remotely.
 */
import { html, render } from "lit-html";
import {
  consumeAuthFlow,
  parseAuthSuccessScript,
} from "./features/account/auth-callback.ts";

const VERSION = __APP_VERSION__;

function showStatus(title: string, lines: string[], ok: boolean) {
  const box = document.createElement("div");
  box.id = "better-intra-auth-status";
  render(
    html`
      <style>
        #better-intra-auth-status {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%);
          max-width: 520px;
          padding: 14px 18px;
          border-radius: 12px;
          background: ${ok ? "#0f766e" : "#b45309"};
          color: #fff;
          font: 14px/1.45 system-ui, -apple-system, sans-serif;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
          z-index: 2147483647;
        }
        #better-intra-auth-status strong {
          display: block;
          margin-bottom: 4px;
        }
        #better-intra-auth-status small {
          opacity: 0.75;
        }
      </style>
      <strong>${title}</strong>
      ${lines.map((l) => html`<div>${l}</div>`)}
      <small>Better Intra ${VERSION}</small>
    `,
    box,
  );
  (document.body || document.documentElement).appendChild(box);
}

(async () => {
  console.info(`Better Intra ${VERSION}: auth callback script running`);

  let creds: { token: string; login: string } | null = null;
  for (const s of Array.from(document.scripts)) {
    creds = parseAuthSuccessScript(s.textContent || "");
    if (creds) break;
  }
  if (!creds) {
    showStatus(
      "Better Intra could not read the login result",
      [
        "This page does not contain the expected credentials.",
        "Close this window and try Connect with 42 again.",
      ],
      false,
    );
    return;
  }

  if (!(await consumeAuthFlow("cloud"))) {
    console.warn(
      "Better Intra: auth callback page reached without a login in progress; ignoring.",
    );
    showStatus(
      "Login not started from Better Intra",
      [
        "For your safety this window is ignored: the extension did not start a login in the last 10 minutes.",
        "Close this window, then click Connect with 42 in the extension popup or in the hub, and complete the login within 10 minutes.",
      ],
      false,
    );
    return;
  }

  await chrome.storage.local.set({
    CLOUD_TOKEN: creds.token,
    CLOUD_LOGIN: creds.login,
    PENDING_SETTINGS_RESTORE: true,
  });
  await chrome.storage.local.remove("CLOUD_AUTH_FAILED");

  showStatus(
    `Connected as ${creds.login}`,
    ["You can close this window. Your Intra tabs will reload."],
    true,
  );

  // Give the opener (if any) a moment to receive the page's own postMessage,
  // then close this window ourselves: the opener may be gone. Browsers refuse
  // to close a tab that was not opened by script; the message above covers it.
  setTimeout(() => window.close(), 400);
})();
