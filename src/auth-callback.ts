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
 */
import {
  consumeAuthFlow,
  parseAuthSuccessScript,
} from "./features/account/auth-callback.ts";

(async () => {
  const scripts = Array.from(document.scripts);
  let creds: { token: string; login: string } | null = null;
  for (const s of scripts) {
    creds = parseAuthSuccessScript(s.textContent || "");
    if (creds) break;
  }
  if (!creds) return;

  if (!(await consumeAuthFlow("cloud"))) {
    console.warn(
      "Better Intra: auth callback page reached without a login in progress; ignoring.",
    );
    return;
  }

  await chrome.storage.local.set({
    CLOUD_TOKEN: creds.token,
    CLOUD_LOGIN: creds.login,
    PENDING_SETTINGS_RESTORE: true,
  });
  await chrome.storage.local.remove("CLOUD_AUTH_FAILED");

  // Give the opener (if any) a moment to receive the page's own postMessage,
  // then close this window ourselves: the opener may be gone.
  setTimeout(() => window.close(), 300);
})();
