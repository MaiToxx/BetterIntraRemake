/**
 * The release workflow (.github/workflows/publish.yaml), read as text: a
 * release must be tested before it is signed, the Chrome Web Store step must
 * use the API that still exists and must never hold back the Firefox and
 * Linux update manifests, and nothing that holds a signing key or a store
 * token may run a moving version.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/publish.yaml"), "utf8").replace(/\r\n/g, "\n");

type Step = { name: string; text: string };

/** The text of one job (between its `  <id>:` line and the next job). */
function job(id: string): string {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  if (start < 0) throw new Error(`job ${id} not found`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The steps of a job, in order: each `      - ` item with its name. */
function steps(id: string): Step[] {
  const body = job(id).split("\n    steps:\n")[1] ?? "";
  return body
    .split(/\n(?= {6}- )/)
    .filter((s) => s.trimStart().startsWith("- "))
    .map((text) => ({ name: /name: (.+)/.exec(text)?.[1].trim() ?? "", text }));
}

function indexOf(list: Step[], name: string): number {
  const i = list.findIndex((s) => s.name === name);
  if (i < 0) throw new Error(`step "${name}" not found`);
  return i;
}

describe("publish.yaml: release gate", () => {
  for (const id of ["build-prerelease", "build-and-sign"]) {
    it(`${id}: tests, theme, cycle and size checks run before anything is signed or uploaded`, () => {
      const list = steps(id);
      const firstRisky = list.findIndex((s) =>
        /crx@|cmd: sign|action-gh-release|chrome-webstore-upload|git push/.test(s.text),
      );
      expect(firstRisky).toBeGreaterThan(0);
      for (const cmd of ["npm test", "npm run check:themes", "npm run check:cycles", "npm run check:size"]) {
        const at = list.findIndex((s) => s.text.includes(`run: ${cmd}`));
        expect(at, cmd).toBeGreaterThan(-1);
        expect(at, cmd).toBeLessThan(firstRisky);
      }
      // the size budgets need both builds
      expect(list.findIndex((s) => s.text.includes("run: npm run check:size"))).toBeGreaterThan(
        list.findIndex((s) => s.text.includes("run: npm run build:chrome")),
      );
    });
  }

  it("pins what it runs: no action on a branch, exact versions for npx tools", () => {
    expect(workflow).not.toMatch(/uses: \S+@(main|master)\b/);
    for (const m of workflow.matchAll(/npx --yes (\S+)/g)) {
      expect(m[1], m[1]).toMatch(/@\d+\.\d+\.\d+$/);
    }
  });
});

describe("publish.yaml: Chrome Web Store", () => {
  const list = steps("build-and-sign");
  const publish = list[indexOf(list, "Publish to Chrome Web Store")];

  it("needs all five secrets, the publisher id included, and stays skipped without them", () => {
    const hasCws = /HAS_CWS: \$\{\{(.+)\}\}/.exec(job("build-and-sign"))?.[1] ?? "";
    for (const secret of ["CWS_EXTENSION_ID", "CWS_PUBLISHER_ID", "CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN"]) {
      expect(hasCws).toContain(`secrets.${secret} != ''`);
    }
    expect(hasCws).not.toContain("||");
    expect(list[indexOf(list, "Build Extension (Chrome Web Store)")].text).toContain("if: env.HAS_CWS == 'true'");
    expect(publish.text).toContain("env.HAS_CWS == 'true'");
  });

  it("uploads and submits through chrome-webstore-upload-cli 4 (API v2), with no subcommand", () => {
    const run = /run: (.+)/.exec(publish.text)?.[1] ?? "";
    expect(run).toMatch(/^npx --yes chrome-webstore-upload-cli@4\.\d+\.\d+ --source better-intra-chrome-store\.zip$/);
    // v4: `upload` never publishes, --auto-publish is gone
    expect(run).not.toMatch(/\bupload --|--auto-publish/);
    expect(publish.text).toContain("PUBLISHER_ID: ${{ secrets.CWS_PUBLISHER_ID }}");
  });

  it("a store failure cannot hold back updates.json/updates.xml, and still leaves a warning", () => {
    const manifests = indexOf(list, "Update auto-update manifests");
    const build = indexOf(list, "Build Extension (Chrome Web Store)");
    // built from the release tag, before the manifests step checks out main
    expect(build).toBeLessThan(manifests);
    expect(list[build].text).toContain("continue-on-error: true");
    expect(indexOf(list, "Publish to Chrome Web Store")).toBeGreaterThan(manifests);
    expect(publish.text).toContain("continue-on-error: true");
    const warn = list[indexOf(list, "Chrome Web Store step failed")];
    expect(warn.text).toContain("steps.cws.outcome == 'failure'");
    expect(warn.text).toContain("::warning::");
  });
});
