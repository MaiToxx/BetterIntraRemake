/**
 * Guards for the OAuth-style callbacks handled in src/main.ts.
 *
 * The worker redirects back to an intra page with the result in the query
 * string (`?token=&login=` for the 42 login, `?discord_id=` for the Discord
 * link). Because the content script runs on every intra page, anyone could
 * craft such a link and have the victim's extension adopt an attacker-chosen
 * account or Discord id (session fixation).
 *
 * To prevent that, the extension records *when it started* a flow, and the
 * callback is only honoured if a matching flow was started recently.
 */

export type AuthFlow = "cloud" | "discord";

/** How long a started flow stays valid. Generous: the user may take a while to sign in. */
export const AUTH_FLOW_TTL_MS = 10 * 60 * 1000;

const PENDING_KEYS: Record<AuthFlow, string> = {
  cloud: "OAUTH_PENDING_AT",
  discord: "DISCORD_AUTH_PENDING_AT",
};

/** Call right before opening the authentication window. */
export async function markAuthFlowPending(flow: AuthFlow): Promise<void> {
  await chrome.storage.local.set({ [PENDING_KEYS[flow]]: Date.now() });
}

/** Pure check, exported for tests. */
export function isAuthFlowFresh(
  pendingAt: unknown,
  now: number = Date.now(),
): boolean {
  if (typeof pendingAt !== "number" || !Number.isFinite(pendingAt)) return false;
  const age = now - pendingAt;
  return age >= 0 && age <= AUTH_FLOW_TTL_MS;
}

/**
 * The worker's "Login Successful" page only does
 *   window.opener.postMessage({ type: "42_AUTH_SUCCESS", token, login }, origin)
 * and waits for the opener to close it. Extract those credentials from that
 * inline script so a content script on the callback page can finish the login
 * itself when the opener is gone (Chrome closes the toolbar popup as soon as
 * the auth window takes focus) or never receives the message.
 */
export function parseAuthSuccessScript(
  scriptText: string,
): { token: string; login: string } | null {
  if (!scriptText.includes("42_AUTH_SUCCESS")) return null;
  const token = /token\s*:\s*"([^"\\]{8,512})"/.exec(scriptText)?.[1];
  const login = /login\s*:\s*"([a-z0-9_.-]{1,64})"/i.exec(scriptText)?.[1];
  if (!token || !login) return null;
  return { token, login };
}

/**
 * Consume the pending marker for a flow. Returns true when the callback may be
 * trusted. The marker is always cleared, so a callback can only be used once.
 */
export async function consumeAuthFlow(
  flow: AuthFlow,
  now: number = Date.now(),
): Promise<boolean> {
  const key = PENDING_KEYS[flow];
  const store = await chrome.storage.local.get(key);
  await chrome.storage.local.remove(key);
  return isAuthFlowFresh(store?.[key], now);
}
