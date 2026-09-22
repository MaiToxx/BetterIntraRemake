import { describe, it, expect } from "vitest";
import {
  ALLOWED_IMAGE_HOSTS,
  disallowedImageHost,
  isAllowedImageHost,
} from "../src/core/security/image-hosts.ts";
import { allowedImageUrl, sanitizeCssUrl } from "../src/core/security/css-sanitize.ts";

// Another student's image is fetched by every viewer's browser from the host
// the author chose: only hosts on the list are contacted.
describe("isAllowedImageHost", () => {
  it("lists the 42 CDN and the usual image hosts", () => {
    for (const host of [
      "cdn.intra.42.fr",
      "profile.intra.42.fr",
      "i.imgur.com",
      "imgur.com",
      "raw.githubusercontent.com",
      "avatars.githubusercontent.com",
      "github.com",
      "cdn.discordapp.com",
      "media.discordapp.net",
      "upload.wikimedia.org",
      "images.unsplash.com",
      "i.ibb.co",
      "i.postimg.cc",
      "gyazo.com",
      "i.gyazo.com",
      "media.giphy.com",
      "c.tenor.com",
      "cdn.jsdelivr.net",
      "d1234.cloudfront.net",
      "www.gravatar.com",
      "lh3.googleusercontent.com",
    ]) {
      expect(isAllowedImageHost(host), host).toBe(true);
    }
  });

  it("a wildcard entry matches subdomains only, an exact entry matches itself only", () => {
    expect(isAllowedImageHost("intra.42.fr")).toBe(false);
    expect(isAllowedImageHost("githubusercontent.com")).toBe(false);
    expect(isAllowedImageHost("www.imgur.com")).toBe(false);
    expect(isAllowedImageHost("evilgithubusercontent.com")).toBe(false);
    expect(isAllowedImageHost("cdn.intra.42.fr.evil.example")).toBe(false);
    expect(isAllowedImageHost("")).toBe(false);
  });

  it("compares hostnames the way the URL parser writes them", () => {
    expect(isAllowedImageHost("I.IMGUR.COM")).toBe(true);
    expect(isAllowedImageHost("i.imgur.com.")).toBe(true);
  });

  it("every list entry is a bare hostname, optionally with a leading *.", () => {
    for (const entry of ALLOWED_IMAGE_HOSTS) {
      expect(entry).toMatch(/^(\*\.)?[a-z0-9.-]+$/);
    }
  });
});

describe("allowedImageUrl", () => {
  it("keeps an https URL on a listed host, normalised like sanitizeCssUrl", () => {
    const url = "https://upload.wikimedia.org/x y_(foo).png";
    expect(allowedImageUrl(url)).toBe(sanitizeCssUrl(url));
    expect(allowedImageUrl(url)).toContain("x%20y_(foo).png");
  });

  it("drops off-list hosts, http and anything sanitizeCssUrl rejects", () => {
    expect(allowedImageUrl("https://my-site.example/a.png")).toBe("");
    expect(allowedImageUrl("http://i.imgur.com/a.png")).toBe("");
    expect(allowedImageUrl("https://i.imgur.com@evil.example/a.png")).toBe("");
    expect(allowedImageUrl('x") } * { display:none } .a { url("')).toBe("");
    expect(allowedImageUrl("javascript:alert(1)")).toBe("");
    expect(allowedImageUrl(42)).toBe("");
  });
});

describe("disallowedImageHost", () => {
  it("names the host the editor should warn about, nothing otherwise", () => {
    expect(disallowedImageHost("https://my-site.example/a.png")).toBe("my-site.example");
    expect(disallowedImageHost(" https://i.imgur.com/a.png ")).toBe("");
    expect(disallowedImageHost("not a url")).toBe("");
  });
});
