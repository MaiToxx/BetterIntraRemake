/**
 * The About tab of this fork: Follow goes to the fork's author (it went to
 * the upstream author, under "Made for 42 Mulhouse"), the upstream author is
 * credited as such, the privacy policy is one click away, and the Chrome Web
 * Store build never offers the GitHub "Download" (Chrome updates a store
 * install itself; the zip loads as a second copy with another id).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "lit-html";
import { renderAboutPanel } from "../src/features/hub/hub.about.ts";
import { FEATURE_DEFS, HUB_INFO } from "../src/features/hub/hubSettings.data.ts";
import { UPDATE_KEY } from "../src/core/update-check.ts";

async function mount(options?: { storeBuild?: boolean }): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(renderAboutPanel(options), host);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  return host;
}

const linkNamed = (root: ParentNode, text: RegExp) =>
  [...root.querySelectorAll("a")].find((a) => text.test((a.textContent ?? "").replace(/\s+/g, " ")));

beforeEach(async () => {
  document.body.replaceChildren();
  await chrome.storage.local.clear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("About tab", () => {
  it("Follow goes to this fork's author, and upstream is credited by name", async () => {
    const host = await mount();
    expect(HUB_INFO.author).toBe("https://github.com/test");
    expect(linkNamed(host, /Follow/)!.getAttribute("href")).toBe(HUB_INFO.author);
    const credit = linkNamed(host, /^nicopasla$/)!;
    expect(credit.getAttribute("href")).toBe(HUB_INFO.upstream);
    expect(credit.parentElement!.textContent).toMatch(/Original project by/);
    // the Sponsors page is named as his, not left as an unlabeled button
    expect(linkNamed(host, /Sponsor nicopasla/)!.getAttribute("href")).toBe(
      "https://github.com/sponsors/nicopasla",
    );
    expect(linkNamed(host, /^\s*Sponsor\s*$/)).toBeUndefined();
  });

  it("links the privacy policy, and names the version link for what it opens", async () => {
    const host = await mount();
    const privacy = linkNamed(host, /Privacy/)!;
    expect(privacy.getAttribute("href")).toBe(`${HUB_INFO.github}/blob/main/PRIVACY.md`);
    expect(privacy.getAttribute("rel")).toContain("noopener");
    const version = host.querySelector<HTMLAnchorElement>(`a[href="${HUB_INFO.github}/releases"]`)!;
    expect(version.getAttribute("aria-label")).toMatch(/Release notes/);
  });

  it("offers the GitHub download of a newer release in a self-hosted build", async () => {
    await chrome.storage.local.set({
      [UPDATE_KEY]: { version: "9.9.9", url: "https://github.com/test/better-intra/releases/tag/v9.9.9" },
    });
    const host = await mount({ storeBuild: false });
    expect(host.textContent).toContain("9.9.9");
    expect(linkNamed(host, /Download/)).toBeDefined();
  });

  it("never offers it in the Chrome Web Store build, even with a stale record", async () => {
    await chrome.storage.local.set({
      [UPDATE_KEY]: { version: "9.9.9", url: "https://github.com/test/better-intra/releases/tag/v9.9.9" },
    });
    const host = await mount({ storeBuild: true });
    expect(host.textContent).not.toContain("9.9.9");
    expect(linkNamed(host, /Download/)).toBeUndefined();
  });

  it("is a self-hosted build when the build defines no store flag", async () => {
    await chrome.storage.local.set({
      [UPDATE_KEY]: { version: "9.9.9", url: "https://github.com/test/better-intra/releases/tag/v9.9.9" },
    });
    const host = await mount();
    expect(linkNamed(host, /Download/)).toBeDefined();
  });
});

describe("Profile tab description", () => {
  it("says the custom images need the sign-in (the editor is behind it)", () => {
    const profile = FEATURE_DEFS.find((f) => f.id === "profile")!;
    expect(profile.desc).not.toMatch(/local profile\/background image/);
    expect(profile.desc).toMatch(/signed in/);
  });
});
