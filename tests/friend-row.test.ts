import { describe, it, expect } from "vitest";
import { render } from "lit-html";
import {
  applyIntraVisuals,
  buildFriendFromIntra,
} from "../src/features/friends/friends-intra";
import { renderFriendRow } from "../src/features/friends/friend-row";
import { cssUrl, sanitizeCssUrl } from "../src/core/security/css-sanitize";
import type { FriendData } from "../src/features/friends/friends-types";

// A friend's avatar URL is chosen by that student and reaches the widget
// unchanged through the worker and sanitizeCssUrl(), which keeps ')' and ';'
// (the host allowlist only says where it is fetched from, imgur here).
const PAYLOAD =
  "https://i.imgur.com/a.png);position:fixed!important;left:-100vw!important;top:-100vh!important;width:300vw!important;height:300vh!important;z-index:2147483647!important;pointer-events:auto!important;background-image:url(https://evil.example/fake.png";
const WIKIMEDIA =
  "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example_(cropped).jpg";

function friendWithAvatar(
  avatar: string,
  extra: Record<string, unknown> = {},
): FriendData {
  const f = buildFriendFromIntra(
    "mallory",
    { displayname: "Mallory", profile_picture: "https://cdn.intra.42.fr/m.jpg" },
    null,
    [],
    null,
  );
  return applyIntraVisuals(f, { avatar, ...extra });
}

function avatarStyle(friend: FriendData): string {
  const host = document.createElement("div");
  render(
    renderFriendRow(friend, {
      rank: -1,
      showCustomAvatars: true,
      deleteMode: false,
      selected: false,
      onAvatarToggle() {},
    }),
    host,
  );
  const div = host.querySelector<HTMLElement>(".avatar > div");
  return div?.getAttribute("style") ?? "";
}

describe("friend row custom avatar", () => {
  it("keeps a CSS-injection URL inside a quoted url()", () => {
    const friend = friendWithAvatar(PAYLOAD);
    const href = sanitizeCssUrl(PAYLOAD);
    // sanitizeCssUrl lets it through: only the quoting makes it harmless
    expect(href).not.toBe("");
    const style = avatarStyle(friend);
    expect(style.startsWith(`background-image:url("${href}");background-size:`)).toBe(true);
    // parsed by the browser, the payload is just part of one URL string
    const probe = document.createElement("div");
    probe.setAttribute("style", style);
    expect(probe.style.position).toBe("");
    expect(probe.style.zIndex).toBe("");
  });

  it("renders URLs with parentheses (they used to make Firefox drop the image)", () => {
    const href = sanitizeCssUrl(WIKIMEDIA);
    expect(avatarStyle(friendWithAvatar(WIKIMEDIA))).toContain(
      `background-image:url("${href}");`,
    );
  });

  it("only lets numbers into the position and scale", () => {
    // What the worker's friends endpoint passes through as-is from another
    // student's settings (oauth mode).
    const friend: FriendData = {
      ...friendWithAvatar("https://i.imgur.com/a.png"),
      avatarScale: "100%;position:fixed" as unknown as number,
      avatarPosX: "20" as unknown as number,
      avatarPosY: 30,
    };
    const style = avatarStyle(friend);
    expect(style).not.toContain("position:fixed");
    expect(style).toContain("background-size:100%;");
    expect(style).toContain("background-position:20% 30%;");
  });
});

describe("cssUrl", () => {
  it("quotes the sanitised URL, or gives nothing", () => {
    expect(cssUrl("https://cdn.example/a b.png")).toBe(
      'url("https://cdn.example/a%20b.png")',
    );
    expect(cssUrl(WIKIMEDIA)).toBe(`url("${WIKIMEDIA}")`);
    expect(cssUrl('x") } * { display:none } .a { url("')).toBe("");
    expect(cssUrl("javascript:alert(1)")).toBe("");
    expect(cssUrl(null)).toBe("");
  });
});
