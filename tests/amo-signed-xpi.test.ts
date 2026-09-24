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
    expect(finish).toContain('node scripts/push-update-manifest.mjs updates.json "$TAG"');
    expect(finish).toContain('node scripts/push-update-manifest.mjs updates.xml "$TAG"');
    expect(finish).toContain("rm -f crx-key.pem");
  });

  /** One step of finish-release.yaml, from its `- name:` to the next. */
  const step = (name: string) => {
    const at = finish.indexOf(`- name: ${name}\n`);
    expect(at, name).toBeGreaterThan(-1);
    const next = finish.indexOf("\n      - name:", at + 1);
    return finish.slice(at, next < 0 ? undefined : next);
  };

  it("the finisher decides first, and never alongside publish.yaml", () => {
    // gh run list needs the actions scope; contents: write alone refuses it
    expect(finish).toMatch(/permissions:\n\s+contents: write\n(\s+#.*\n)*\s+actions: read/);
    expect(step("What the release lacks")).toContain("node scripts/release-state.mjs");
    const acting = [
      "Checkout the release",
      "Build the Chrome files",
      "Pack the Chrome .crx",
      "Attach the Chrome files",
      "Chrome auto-update manifest",
      "Signed .xpi from Mozilla",
      "Attach the .xpi and publish the Firefox update",
    ];
    for (const name of acting) {
      expect(step(name), name).toMatch(/if: .*steps\.(state|chrome-build|chrome|amo)\.outputs\./);
    }
    // a shared concurrency group would let a scheduled run cancel a queued release
    expect(finish).not.toMatch(/group: .*publish/);
  });

  it("the finisher runs publish.yaml's whole gate, after the tag check, before it attaches Chrome files", () => {
    const build = step("Build the Chrome files");
    const tag = build.indexOf("check-release-tag.mjs");
    const gate = build.indexOf("npm run release:check");
    expect(tag).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(tag);
    expect(gate).toBeLessThan(build.indexOf("web-ext build"));
    // packing and attaching follow only a build that went through the gate
    expect(build).toContain('echo "built=true" >> "$GITHUB_OUTPUT"');
    for (const name of ["Pack the Chrome .crx", "Attach the Chrome files"]) {
      expect(step(name), name).toContain("steps.chrome-build.outputs.built == 'true'");
      expect(finish.indexOf(`- name: ${name}\n`), name).toBeGreaterThan(finish.indexOf("- name: Build the Chrome files\n"));
    }
    const attach = step("Attach the Chrome files");
    expect(attach).toContain("gh release upload");
    // updates.xml follows only files this run attached (or a repair)
    expect(attach).toContain('echo "attached=true" >> "$GITHUB_OUTPUT"');
    expect(step("Chrome auto-update manifest")).toContain("steps.chrome.outputs.attached == 'true'");
  });

  it("the .crx key reaches the packing step alone, never the install, the tests or the builds", () => {
    // HAS_CRX (job env) is a boolean made from the secret, not the key itself
    const withKey = finish
      .split(/\n(?=      - name: )/)
      .filter((s) => s.includes("${{ secrets.CRX_PRIVATE_KEY }}"));
    expect(withKey.map((s) => s.trim().split("\n")[0])).toEqual(["- name: Pack the Chrome .crx"]);
    expect(withKey[0]).not.toMatch(/npm (ci|test|run)/);
    expect(step("Build the Chrome files")).not.toContain("CRX_PRIVATE_KEY");
  });

  it("the finisher fails on a version Mozilla never created or refused, only inside the alarm window", () => {
    const amo = step("Signed .xpi from Mozilla");
    expect(amo).toContain("ALARM: ${{ steps.state.outputs.amo_alarm }}");
    expect(amo).toMatch(/2\|4\)[\s\S]*if \[ "\$ALARM" = "true" \]; then echo "::error::\$what\."; exit 1; fi/);
    expect(amo).toContain("*) exit $code ;;");
  });
});
