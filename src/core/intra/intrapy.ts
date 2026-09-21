/**
 * The Intra session token the v3 pages send to intrapy.intra.42.fr. hook.js
 * (running in the page) relays it as a DOM event and caches it; this module
 * is how content-script features obtain it without ever asking for a password.
 */
const TOKEN_STORAGE_KEY = "ft_intrapy_token";
const TOKEN_EVENT = "42_INTRAPY_TOKEN";

function b64urlToString(segment: string): string | null {
  try {
    const pad =
      segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return atob(b64);
  } catch {
    return null;
  }
}

/**
 * Whether a JWT's `exp` claim is in the past. The payload is decoded without
 * verification (the caller only wants to know if the token is worth sending).
 * Anything that is not a JWT with a numeric `exp` is reported as not expired,
 * so opaque tokens keep working as before.
 */
export function isJwtExpired(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (typeof token !== "string") return false;
  const compact = token.replace(/^Bearer\s+/i, "").trim();
  const parts = compact.split(".");
  if (parts.length !== 3) return false;
  const json = b64urlToString(parts[1]);
  if (json === null) return false;
  try {
    const payload = JSON.parse(json) as { exp?: unknown };
    if (!payload || typeof payload.exp !== "number") return false;
    return payload.exp * 1000 <= nowMs;
  } catch {
    return false;
  }
}

/** The Intra token hook.js cached in sessionStorage, expired or not. */
export function getStoredIntrapyToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Resolve with a usable Intra session token, or null after `timeout` ms.
 *
 * hook.js dispatches 42_INTRAPY_TOKEN every time the page authenticates a
 * request, and caches the last token in sessionStorage. That cached token can
 * be an expired Keycloak JWT (the tab was left open); it is then ignored and
 * the next token dispatched by the page is awaited instead.
 */
export function waitForIntrapyToken(
  timeout = 4000,
): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let timer: ReturnType<typeof setTimeout>;

    const handler = (e: Event) => {
      if (resolved) return;
      const token = (e as CustomEvent<unknown>).detail;
      if (typeof token !== "string" || !token) return;
      // hook.js re-dispatches the stored token on load: skip it if stale
      if (isJwtExpired(token)) return;
      resolved = true;
      cleanup();
      resolve(token);
    };
    const cleanup = () => {
      document.removeEventListener(TOKEN_EVENT, handler);
      clearTimeout(timer);
    };
    document.addEventListener(TOKEN_EVENT, handler);

    const stored = getStoredIntrapyToken();
    if (stored && !isJwtExpired(stored)) {
      resolved = true;
      cleanup();
      resolve(stored);
      return;
    }

    timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeout);
  });
}
