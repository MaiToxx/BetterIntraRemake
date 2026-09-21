import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isJwtExpired, waitForIntrapyToken } from "../src/core/intra/intrapy";

const b64url = (s: string) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const now = 1_800_000_000_000;
const jwt = (payload: Record<string, unknown>) =>
  `${b64url(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64url(JSON.stringify(payload))}.c2ln`;

const expired = "Bearer " + jwt({ exp: Math.floor(now / 1000) - 60 });
const fresh = "Bearer " + jwt({ exp: Math.floor(now / 1000) + 300 });

describe("isJwtExpired", () => {
  it("reads exp from the payload, with or without the Bearer prefix", () => {
    expect(isJwtExpired(expired, now)).toBe(true);
    expect(isJwtExpired(fresh, now)).toBe(false);
    expect(isJwtExpired(jwt({ exp: Math.floor(now / 1000) - 1 }), now)).toBe(true);
  });

  it("treats exp equal to now as expired", () => {
    expect(isJwtExpired(jwt({ exp: now / 1000 }), now)).toBe(true);
  });

  it("does not report opaque or malformed tokens as expired", () => {
    expect(isJwtExpired("Bearer opaque-token", now)).toBe(false);
    expect(isJwtExpired("a.b", now)).toBe(false);
    expect(isJwtExpired("a.!!!.c", now)).toBe(false);
    expect(isJwtExpired(`a.${b64url("not json")}.c`, now)).toBe(false);
    expect(isJwtExpired(jwt({ sub: "no exp" }), now)).toBe(false);
    expect(isJwtExpired(jwt({ exp: "soon" }), now)).toBe(false);
    expect(isJwtExpired(null, now)).toBe(false);
    expect(isJwtExpired(undefined, now)).toBe(false);
    expect(isJwtExpired("", now)).toBe(false);
  });
});

describe("waitForIntrapyToken", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  const dispatch = (token: string) =>
    document.dispatchEvent(new CustomEvent("42_INTRAPY_TOKEN", { detail: token }));

  it("returns the stored token immediately when it is still valid", async () => {
    sessionStorage.setItem("ft_intrapy_token", fresh);
    await expect(waitForIntrapyToken(1000)).resolves.toBe(fresh);
  });

  it("still returns an opaque stored token", async () => {
    sessionStorage.setItem("ft_intrapy_token", "Bearer opaque");
    await expect(waitForIntrapyToken(1000)).resolves.toBe("Bearer opaque");
  });

  it("ignores an expired stored token and waits for the next dispatched one", async () => {
    sessionStorage.setItem("ft_intrapy_token", expired);
    const p = waitForIntrapyToken(5000);
    // hook.js re-dispatches the stale stored token on load: must be skipped too
    dispatch(expired);
    dispatch(fresh);
    await expect(p).resolves.toBe(fresh);
  });

  it("times out with null when no fresh token arrives", async () => {
    sessionStorage.setItem("ft_intrapy_token", expired);
    const p = waitForIntrapyToken(2000);
    dispatch(expired);
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toBeNull();
  });
});
