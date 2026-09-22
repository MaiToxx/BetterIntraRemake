/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The document_start avatar hold. main.ts used to hide the first avatar it saw
 * with an inline `opacity: 0` from a document-wide MutationObserver and reveal
 * it from a 5 s timer: with the Profile feature off, the avatar was invisible
 * for those 5 s on every load, and on the other Intra hosts the observer never
 * disconnected. The hold is now the class rule the profile watcher already
 * uses, installed alone at document_start and released whenever that watcher
 * will not run.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AVATAR_PENDING_CLASS,
  holdAvatar,
  injectAvatarPendingRule,
  injectCustomStyles,
  releaseAvatar,
} from "../src/features/profile/header/visuals-apply.ts";

const mountAvatar = (): HTMLElement => {
  const el = document.createElement("div");
  el.className = "rounded-full w-52 h-52";
  document.body.appendChild(el);
  return el;
};
const opacity = (el: HTMLElement) => getComputedStyle(el).opacity;

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.classList.remove(AVATAR_PENDING_CLASS);
});

describe("injectAvatarPendingRule", () => {
  it("makes the hold effective before the profile sheet exists", () => {
    injectAvatarPendingRule();
    holdAvatar();
    // Before: only injectCustomStyles() (initProfile) carried this rule.
    expect(opacity(mountAvatar())).toBe("0");
    releaseAvatar();
    expect(opacity(mountAvatar())).not.toBe("0");
  });

  it("is installed once, whichever of the two entry points runs first", () => {
    injectAvatarPendingRule();
    injectCustomStyles();
    injectAvatarPendingRule();
    expect(document.querySelectorAll("#ft-avatar-pending-style")).toHaveLength(1);
    holdAvatar();
    expect(opacity(mountAvatar())).toBe("0");
  });
});

describe("main.ts start-up", () => {
  const src = readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf8");

  it("never writes an inline opacity on the avatar", () => {
    expect(src).not.toMatch(/setProperty\(\s*["']opacity["']/);
  });

  it("holds the avatar only on the profile origin and releases it when the profile feature is off", () => {
    expect(src).toMatch(
      /location\.hostname === "profile-v3\.intra\.42\.fr"\)\s*\{\s*injectAvatarPendingRule\(\);\s*holdAvatar\(\);/,
    );
    expect(src).toMatch(/if \(!activeScripts\.includes\("profile"\)\) releaseAvatar\(\);/);
  });
});
