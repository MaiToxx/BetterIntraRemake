/**
 * @vitest-environment node
 *
 * scripts/push-update-manifest.mjs: how publish.yaml and finish-release.yaml
 * write updates.json / updates.xml on main. A push rejected because main
 * moved used to fail the job after the file was attached, and nothing ever
 * repaired it.
 */
import { describe, it, expect, vi } from "vitest";
import { pushUpdateManifest } from "../scripts/push-update-manifest.mjs";

type Call = [string, string[]];

/** A fake `run`: every command succeeds except those `fail` says no to. */
function runner(fail: (cmd: string, args: string[], calls: Call[]) => boolean = () => false) {
  const calls: Call[] = [];
  const run = vi.fn((cmd: string, args: string[]) => {
    calls.push([cmd, args]);
    return { status: fail(cmd, args, calls) ? 1 : 0, stdout: "", stderr: "" };
  });
  return { run, calls };
}

const isPush = (cmd: string, args: string[]) => cmd === "git" && args[0] === "push";
const isStagedCheck = (cmd: string, args: string[]) => cmd === "git" && args[0] === "diff";
const git = (calls: Call[]) => calls.filter(([c]) => c === "git").map(([, a]) => a.filter((x) => !x.startsWith("user.") && x !== "-c").join(" "));
const noWait = () => Promise.resolve();
const log = () => {};

describe("push-update-manifest", () => {
  it("fetches main, writes the file with main's script, commits as the bot and pushes to main", async () => {
    // `git diff --cached --quiet` exits 1 when something is staged
    const { run, calls } = runner(isStagedCheck);
    expect(await pushUpdateManifest({ file: "updates.json", version: "1.16.1", run, wait: noWait, log })).toBe("pushed");
    expect(git(calls)).toEqual([
      "fetch origin main",
      "checkout --force --detach FETCH_HEAD",
      "add updates.json",
      "diff --cached --quiet",
      "commit -m chore: update updates.json for v1.16.1",
      "push origin HEAD:main",
    ]);
    const script = calls.find(([c]) => c === process.execPath)![1];
    expect(script).toEqual(["scripts/update-updates-json.js", "1.16.1"]);
    const commit = calls.find(([, a]) => a.includes("commit"))![1];
    expect(commit).toContain("user.name=github-actions[bot]");
  });

  it("starts again from a fresh main when the push is rejected, and gives up loudly after three tries", async () => {
    const rejectTwice = runner((cmd, args, calls) => isStagedCheck(cmd, args) || (isPush(cmd, args) && calls.filter(([c, a]) => isPush(c, a)).length < 3));
    const wait = vi.fn(noWait);
    expect(await pushUpdateManifest({ file: "updates.json", version: "1.16.1", run: rejectTwice.run, wait, log })).toBe("pushed");
    expect(git(rejectTwice.calls).filter((c) => c === "fetch origin main")).toHaveLength(3);
    expect(wait).toHaveBeenCalledTimes(2);

    const rejectAll = runner((cmd, args) => isStagedCheck(cmd, args) || isPush(cmd, args));
    await expect(pushUpdateManifest({ file: "updates.json", version: "1.16.1", run: rejectAll.run, wait: noWait, log })).rejects.toThrow(
      /after 3 tries/,
    );
  });

  it("nothing staged means main already has it: no commit, no push", async () => {
    const { run, calls } = runner();
    expect(await pushUpdateManifest({ file: "updates.json", version: "1.16.1", run, wait: noWait, log })).toBe("unchanged");
    expect(git(calls).some((c) => c.startsWith("commit") || c.startsWith("push"))).toBe(false);
  });

  it("a failing git step stops at once (not a retry)", async () => {
    const { run } = runner((cmd, args) => cmd === "git" && args[0] === "fetch");
    await expect(pushUpdateManifest({ file: "updates.xml", version: "1.16.1", run, wait: noWait, log, readFile: () => "" })).rejects.toThrow(
      /git fetch origin main failed/,
    );
  });

  it("updates.xml never moves backwards: an older tag leaves a newer announcement alone", async () => {
    const xml = (v: string) => `<gupdate><app appid='a'><updatecheck codebase='x' version='${v}' /></app></gupdate>`;
    const older = runner(isStagedCheck);
    expect(
      await pushUpdateManifest({ file: "updates.xml", version: "1.15.0", run: older.run, wait: noWait, log, readFile: () => xml("1.16.0") }),
    ).toBe("unchanged");
    expect(older.calls.some(([c]) => c === process.execPath)).toBe(false);

    const newer = runner(isStagedCheck);
    expect(
      await pushUpdateManifest({ file: "updates.xml", version: "1.16.1", run: newer.run, wait: noWait, log, readFile: () => xml("1.16.0") }),
    ).toBe("pushed");
    expect(newer.calls.find(([c]) => c === process.execPath)![1]).toEqual(["scripts/update-updates-xml.js", "1.16.1"]);
  });

  it("refuses a file it does not know", async () => {
    const { run } = runner();
    await expect(pushUpdateManifest({ file: "package.json", version: "1.16.1", run, wait: noWait, log })).rejects.toThrow(/unknown/);
  });
});
