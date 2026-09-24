/**
 * @vitest-environment node
 *
 * scripts/amo-signed-xpi.mjs, which finish-release.yaml runs every half hour
 * to pick up a version Mozilla approved after publish.yaml stopped waiting.
 */
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { amoToken, versionState, downloadSigned } from "../scripts/amo-signed-xpi.mjs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("AMO token", () => {
  it("is an HS256 JWT issued by the key, valid one minute", () => {
    const token = amoToken("user:1:2", "s3cret", 1_000_000);
    const [h, p, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toMatchObject({ iss: "user:1:2", iat: 1_000_000, exp: 1_000_060 });
    expect(typeof payload.jti).toBe("string");
    expect(sig).toBe(createHmac("sha256", "s3cret").update(`${h}.${p}`).digest("base64url"));
  });
});

describe("version state on AMO", () => {
  const base = { guid: "better-intra@maitoxx.github", key: "k", secret: "s" };

  it("signed: returns the file url, and asks with the JWT and unlisted versions", async () => {
    const fetchImpl = vi.fn(async (url: URL, init: RequestInit) => {
      expect(String(url)).toContain("/addons/addon/better-intra%40maitoxx.github/versions/");
      expect(String(url)).toContain("filter=all_with_unlisted");
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^JWT /);
      return json({ next: null, results: [{ version: "1.14.1", file: { status: "public", url: "https://addons.mozilla.org/f/x.xpi" } }] });
    });
    expect(await versionState({ ...base, version: "1.14.1", fetchImpl })).toEqual({
      state: "signed",
      url: "https://addons.mozilla.org/f/x.xpi",
    });
  });

  it("waiting while the file is unreviewed, refused once disabled, missing when absent", async () => {
    const page = (file: object) => vi.fn(async () => json({ next: null, results: [{ version: "1.14.1", file }] }));
    expect((await versionState({ ...base, version: "1.14.1", fetchImpl: page({ status: "unreviewed" }) })).state).toBe("waiting");
    expect((await versionState({ ...base, version: "1.14.1", fetchImpl: page({ status: "disabled" }) })).state).toBe("refused");
    expect((await versionState({ ...base, version: "9.9.9", fetchImpl: page({ status: "public", url: "u" }) })).state).toBe("missing");
    expect((await versionState({ ...base, version: "1.14.1", fetchImpl: vi.fn(async () => json({}, 404)) })).state).toBe("missing");
  });

  it("follows the pages of the version list", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ next: "https://addons.mozilla.org/api/v5/next", results: [{ version: "1.13.2", file: { status: "public", url: "a" } }] }))
      .mockResolvedValueOnce(json({ next: null, results: [{ version: "1.14.1", file: { status: "public", url: "b" } }] }));
    expect(await versionState({ ...base, version: "1.14.1", fetchImpl })).toEqual({ state: "signed", url: "b" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("an AMO error is an error, not a 'waiting'", async () => {
    await expect(versionState({ ...base, version: "1.14.1", fetchImpl: vi.fn(async () => json({}, 500)) })).rejects.toThrow(/500/);
  });

  it("downloads with the JWT too", async () => {
    const fetchImpl = vi.fn(async (_url: URL, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^JWT /);
      return new Response(new Uint8Array([80, 75, 3, 4]));
    });
    expect(await downloadSigned({ url: "https://addons.mozilla.org/f/x.xpi", key: "k", secret: "s", fetchImpl })).toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
  });
});

describe("publish.yaml hands a slow signing over to finish-release.yaml", () => {
  const publish = fs.readFileSync(".github/workflows/publish.yaml", "utf8");
  const finish = fs.readFileSync(".github/workflows/finish-release.yaml", "utf8");

  it("does not fail the release while Mozilla reviews", () => {
    const sign = publish.slice(publish.indexOf("- name: web-ext sign (Firefox)"));
    expect(sign.slice(0, sign.indexOf("- name:", 10))).toContain("continue-on-error: true");
    expect(publish).toContain("steps.web-ext-sign.outcome == 'success'");
  });

  it("the finisher runs on a schedule, completes both browsers, and never commits a secret", () => {
    expect(finish).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(finish).toContain("scripts/amo-signed-xpi.mjs");
    expect(finish).toContain("update-updates-json.js");
    expect(finish).toContain("update-updates-xml.js");
    expect(finish).toContain("rm -f crx-key.pem");
  });

  it("the finisher runs the tests before it builds the Chrome files", () => {
    const step = finish.slice(finish.indexOf("- name: Build and attach the Chrome files"));
    expect(step.indexOf("npm test")).toBeGreaterThan(0);
    expect(step.indexOf("npm test")).toBeLessThan(step.indexOf("npm run build:chrome"));
  });
});
