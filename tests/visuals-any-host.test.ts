/**
 * Other students' images load from wherever they are hosted. 1.13.0 filtered
 * them through a host allowlist, which emptied most profiles at 42 Mulhouse
 * (Pinterest, Reddit, Pexels, Wikia, Tenor... were all off the list).
 */
import { describe, it, expect } from "vitest";
import { sanitizeVisualUrls } from "../src/features/profile/header/visuals-sanitize";
import { applyIntraVisuals } from "../src/features/friends/friends-intra";
import { sanitizePublicLook } from "../src/features/customize/public-look";

const HOSTS = [
  "https://i.pinimg.com/originals/a/b/c.jpg",
  "https://i.redd.it/abc.png",
  "https://static.wikia.nocookie.net/x/images/a.png",
  "https://images.pexels.com/photos/1/a.jpeg",
  "https://media.tenor.com/x/a.gif",
  "https://www.catisfactions.fr/cat.png",
];

describe("images of other students", () => {
  it.each(HOSTS)("keeps %s on the profile", (url) => {
    const v = sanitizeVisualUrls({ avatar: url, banner: url, background: url } as never);
    expect(v.avatar).toBe(url);
    expect(v.banner).toBe(url);
    expect(v.background).toBe(url);
  });

  it("keeps any https host in the friends widget and the shared look", () => {
    const friend = { login: "bob", customAvatar: null, avatarBg: "transparent" } as never;
    expect(applyIntraVisuals(friend, { avatar: HOSTS[0] }).customAvatar).toBe(HOSTS[0]);
    expect(sanitizePublicLook({ CUSTOM_PAGE_BG_URL: HOSTS[1] })?.CUSTOM_PAGE_BG_URL).toBe(HOSTS[1]);
  });

  it("still refuses what is not an http(s) URL", () => {
    expect(sanitizeVisualUrls({ avatar: "javascript:alert(1)" } as never).avatar).toBe("");
  });
});
