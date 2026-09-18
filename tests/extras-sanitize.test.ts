import { describe, it, expect } from "vitest";
import {
  hasVisibleExtras,
  normalizeLink,
  parseFlair,
  sanitizeProfileExtras,
  sanitizeText,
} from "../src/features/profile/extras/extras-sanitize";
import {
  EXTRAS_KEYS,
  LIMITS,
  type ProfileExtras,
} from "../src/features/profile/extras/extras";
import { CONFIG_DEFAULT } from "../src/config";

const HEX = /^#[0-9a-f]{6}$/i;

/** The owner's settings, all at their default value. */
function defaultRaw(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of EXTRAS_KEYS) out[key] = CONFIG_DEFAULT[key];
  return out;
}

/** What sanitizeProfileExtras() returns for settings that show nothing, if it did not return null. */
function neutralExtras(): ProfileExtras {
  return {
    bio: "",
    statusEmoji: "",
    statusText: "",
    pronouns: "",
    flair: [],
    greeting: "",
    links: [],
    nameStyle: "default",
    nameColor: "#00babc",
    nameColor2: "#7c3aed",
    nameFont: "default",
    frame: "none",
    frameColor: "#00babc",
    frameColor2: "#7c3aed",
    levelStyle: "default",
    levelColor: "#00babc",
    levelColor2: "#7c3aed",
    bannerGradient: "none",
    bannerDim: 0,
    bannerBlur: 0,
    cardGlow: false,
    effect: "none",
    effectIntensity: "medium",
    effectColor: "",
  };
}

/** Settings that would produce these extras (what the owner would have typed). */
function toRaw(x: ProfileExtras): Record<string, unknown> {
  const link = (kind: string): string => {
    const found = x.links.find((l) => l.kind === kind);
    return found ? found.href || found.label : "";
  };
  return {
    PROFILE_PUB_ENABLED: true,
    PROFILE_PUB_BIO: x.bio,
    PROFILE_PUB_STATUS_EMOJI: x.statusEmoji,
    PROFILE_PUB_STATUS_TEXT: x.statusText,
    PROFILE_PUB_PRONOUNS: x.pronouns,
    PROFILE_PUB_FLAIR: x.flair.join(" "),
    PROFILE_PUB_GREETING: x.greeting,
    PROFILE_PUB_LINK_GITHUB: link("github"),
    PROFILE_PUB_LINK_GITLAB: link("gitlab"),
    PROFILE_PUB_LINK_LINKEDIN: link("linkedin"),
    PROFILE_PUB_LINK_WEBSITE: link("website"),
    PROFILE_PUB_LINK_DISCORD: link("discord"),
    PROFILE_PUB_NAME_STYLE: x.nameStyle,
    PROFILE_PUB_NAME_COLOR: x.nameColor,
    PROFILE_PUB_NAME_COLOR_2: x.nameColor2,
    PROFILE_PUB_NAME_FONT: x.nameFont,
    PROFILE_PUB_FRAME: x.frame,
    PROFILE_PUB_FRAME_COLOR: x.frameColor,
    PROFILE_PUB_FRAME_COLOR_2: x.frameColor2,
    PROFILE_PUB_LEVEL_STYLE: x.levelStyle,
    PROFILE_PUB_LEVEL_COLOR: x.levelColor,
    PROFILE_PUB_LEVEL_COLOR_2: x.levelColor2,
    PROFILE_PUB_BANNER_GRADIENT: x.bannerGradient,
    PROFILE_PUB_BANNER_DIM: x.bannerDim,
    PROFILE_PUB_BANNER_BLUR: x.bannerBlur,
    PROFILE_PUB_CARD_GLOW: x.cardGlow,
    PROFILE_PUB_EFFECT: x.effect,
    PROFILE_PUB_EFFECT_INTENSITY: x.effectIntensity,
    PROFILE_PUB_EFFECT_TINT: x.effectColor !== "",
    PROFILE_PUB_EFFECT_COLOR: x.effectColor || "#ffffff",
  };
}

describe("sanitizeText", () => {
  it("only accepts strings", () => {
    for (const v of [undefined, null, 42, true, {}, ["a"], () => "a", Symbol("a")]) {
      expect(sanitizeText(v, 50)).toBe("");
    }
    expect(sanitizeText("hello", 50)).toBe("hello");
  });

  it("gives nothing for a limit that is not a positive number", () => {
    expect(sanitizeText("hello", 0)).toBe("");
    expect(sanitizeText("hello", -3)).toBe("");
    expect(sanitizeText("hello", NaN)).toBe("");
    expect(sanitizeText("hello", Infinity)).toBe("");
    expect(sanitizeText("hello", 2.9)).toBe("he");
  });

  it("normalises to NFC", () => {
    expect(sanitizeText("e\u0301cole", 50)).toBe("\u00E9cole");
    // the limit counts the composed characters
    expect(sanitizeText("e\u0301e\u0301e\u0301", 2)).toBe("\u00E9\u00E9");
  });

  it("removes C0 / C1 control characters and DEL", () => {
    expect(sanitizeText("a\u0000b\u0007c\u001Bd\u007Fe\u0080f\u009Bg", 50)).toBe("abcdefg");
  });

  it("removes bidi overrides and isolates", () => {
    expect(sanitizeText("invoice\u202Egnp.exe", 50)).toBe("invoicegnp.exe");
    const all = "\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069";
    expect(sanitizeText(`a${all}b`, 50)).toBe("ab");
    expect(sanitizeText(all, 50)).toBe("");
  });

  it("removes zero-width padding but keeps the joiner of emoji sequences", () => {
    expect(sanitizeText("a\u200Bb\u200Cc\uFEFFd", 50)).toBe("abcd");
    expect(sanitizeText("\u200B\u200C\uFEFF", 50)).toBe("");
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(sanitizeText(family, 50)).toBe(family);
  });

  it("removes lone surrogates", () => {
    expect(sanitizeText("a\uD83Db\uDE00c", 50)).toBe("abc");
    expect(sanitizeText("a\u{1F600}c", 50)).toBe("a\u{1F600}c");
  });

  it("turns every white space run into one space and trims", () => {
    expect(sanitizeText("  a \n\n b\t\tc\r\nd\u00A0\u3000e\u2028f\u0085g  ", 50)).toBe(
      "a b c d e f g",
    );
    expect(sanitizeText(" \n\t ", 50)).toBe("");
    // a removed character between two spaces does not leave two spaces
    expect(sanitizeText("a \u0000 b", 50)).toBe("a b");
  });

  it("caps to a number of code points, never splitting a surrogate pair", () => {
    expect(sanitizeText("x".repeat(500), LIMITS.bio)).toHaveLength(LIMITS.bio);
    const smile = "\u{1F600}";
    expect(sanitizeText(smile.repeat(10), 3)).toBe(smile.repeat(3));
    expect(sanitizeText(`ab${smile}cd`, 3)).toBe(`ab${smile}`);
    expect(sanitizeText(`ab${smile}cd`, 2)).toBe("ab");
    for (let max = 1; max <= 8; max++) {
      const cut = sanitizeText(`a${smile}b${smile}c${smile}`, max);
      expect(Array.from(cut)).toHaveLength(Math.min(max, 6));
      expect(cut).not.toMatch(/[\uD800-\uDFFF]/u); // no half pair
    }
  });

  it("does not leave a dangling space or joiner at the cut", () => {
    expect(sanitizeText("abc def", 4)).toBe("abc");
    expect(sanitizeText("\u{1F468}\u200D\u{1F469}", 2)).toBe("\u{1F468}");
  });

  it("limits stacked combining marks (zalgo)", () => {
    const zalgo = `a${"\u0301".repeat(50)}b`;
    expect(sanitizeText(zalgo, 200)).toBe(`\u00E1${"\u0301".repeat(4)}b`);
    // ordinary sequences are untouched
    expect(sanitizeText("1\uFE0F\u20E3 \u0E01\u0E34\u0E48", 50)).toBe("1\uFE0F\u20E3 \u0E01\u0E34\u0E48");
  });

  it("is idempotent", () => {
    const samples = [
      "  he\u0301llo \n wor\u202Eld  ",
      "e\u200B\u0301", // removing the U+200B creates a composable pair
      `a${"\u0344".repeat(10)}b`, // a mark that NFC splits in two
      `${"x".repeat(158)} \u{1F600}\u200D\u{1F600}`,
      "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} family",
      "a\uD83D",
    ];
    for (const sample of samples) {
      for (const max of [3, 10, 160]) {
        const once = sanitizeText(sample, max);
        expect(sanitizeText(once, max)).toBe(once);
      }
    }
  });
});

describe("parseFlair", () => {
  it("splits on any white space", () => {
    expect(parseFlair("\u{1F525} \u{1F680}\n\u2728\t\u2B50")).toEqual([
      "\u{1F525}",
      "\u{1F680}",
      "\u2728",
      "\u2B50",
    ]);
    expect(parseFlair("   ")).toEqual([]);
    expect(parseFlair("")).toEqual([]);
  });

  it("only accepts strings", () => {
    for (const v of [undefined, null, 42, true, {}, ["\u{1F525}"]]) {
      expect(parseFlair(v)).toEqual([]);
    }
  });

  it("keeps at most LIMITS.flairItems tokens, counting the kept ones", () => {
    const many = Array.from({ length: 12 }, () => "\u2B50").join(" ");
    expect(parseFlair(many)).toHaveLength(LIMITS.flairItems);
    expect(parseFlair("abc \u{1F525} def \u{1F680}")).toEqual(["\u{1F525}", "\u{1F680}"]);
  });

  it("drops tokens that are too long instead of cutting them", () => {
    const fire = "\u{1F525}"; // 2 UTF-16 units
    expect(parseFlair(fire.repeat(8))).toEqual([fire.repeat(8)]); // 16 units
    expect(parseFlair(fire.repeat(9))).toEqual([]); // 18 units
    expect(parseFlair("\u2605".repeat(LIMITS.flairItemLength))).toHaveLength(1);
    expect(parseFlair("\u2605".repeat(LIMITS.flairItemLength + 1))).toEqual([]);
    expect(parseFlair("\u2605".repeat(400))).toEqual([]);
  });

  it("drops text and anything meaningful in HTML, CSS or URLs", () => {
    const hostile = [
      "abc",
      "42",
      "1\uFE0F\u20E3", // keycap: built on an ASCII digit
      "<script>",
      "<\u2605>",
      "\u2605&\u2605",
      '\u2605"',
      "\u2605'",
      "\u2605`",
      "\u2605=\u2605",
      "\u2605/\u2605",
      "\u2605\\\u2605",
      "javascript:alert(1)",
    ];
    for (const token of hostile) expect(parseFlair(`${token} \u{1F525}`)).toEqual(["\u{1F525}"]);
  });

  it("cleans each token", () => {
    expect(parseFlair("\u202E\u{1F525}\u200B \u200B \u0000")).toEqual(["\u{1F525}"]);
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(parseFlair(family)).toEqual([family]);
  });

  it("is idempotent", () => {
    const once = parseFlair("\u{1F525}  abc \u202E\u{1F680}\n\u2728 \u2605\u2605 # * ! \u2B50 \u2B50");
    expect(once).toHaveLength(LIMITS.flairItems);
    expect(parseFlair(once.join(" "))).toEqual(once);
  });
});

describe("normalizeLink", () => {
  it("github: user name, @user or profile URL", () => {
    const expected = { kind: "github", label: "octocat", href: "https://github.com/octocat" };
    for (const v of [
      "octocat",
      "@octocat",
      "  octocat  ",
      "github.com/octocat",
      "www.github.com/octocat",
      "https://github.com/octocat",
      "https://github.com/octocat/",
      "http://github.com/octocat",
      "HTTPS://GitHub.com/octocat?tab=repositories",
      "https://github.com/octocat#readme",
    ]) {
      expect(normalizeLink("github", v)).toEqual(expected);
    }
    expect(normalizeLink("github", "a".repeat(39))?.label).toBe("a".repeat(39));
    expect(normalizeLink("github", "Octo-Cat-42")?.href).toBe("https://github.com/Octo-Cat-42");
  });

  it("github: rejects everything else", () => {
    for (const v of [
      "",
      "   ",
      "@",
      "-octocat",
      "a".repeat(40),
      "octo cat",
      "octo_cat",
      "octo.cat",
      "octocat/repo",
      "github.com/octocat/repo",
      "github.com/octocat/../evil",
      "https://github.com/",
      "https://evil.example/octocat",
      "https://github.com.evil.example/octocat",
      "https://evil.example/github.com/octocat",
      "https://gitlab.com/octocat",
      "javascript:alert(1)",
      'octocat"><script>alert(1)</script>',
      "octocat\u202E",
      "oct\u00F6cat",
      42,
      null,
      undefined,
      { toString: () => "octocat" },
    ]) {
      // the bidi character is removed, which leaves a valid name
      if (v === "octocat\u202E") expect(normalizeLink("github", v)?.label).toBe("octocat");
      else expect(normalizeLink("github", v)).toBeNull();
    }
  });

  it("gitlab: user name, @user or profile URL", () => {
    const expected = { kind: "gitlab", label: "john.doe_1", href: "https://gitlab.com/john.doe_1" };
    for (const v of [
      "john.doe_1",
      "@john.doe_1",
      "gitlab.com/john.doe_1",
      "https://gitlab.com/john.doe_1/",
      "https://www.gitlab.com/john.doe_1",
    ]) {
      expect(normalizeLink("gitlab", v)).toEqual(expected);
    }
    expect(normalizeLink("gitlab", "a".repeat(64))?.label).toHaveLength(64);
    expect(normalizeLink("gitlab", "_x")?.href).toBe("https://gitlab.com/_x");
  });

  it("gitlab: rejects everything else", () => {
    for (const v of [
      "",
      "-john",
      ".john",
      "..",
      "a".repeat(65),
      "jo hn",
      "john/project",
      "gitlab.com/group/project",
      "https://github.com/john",
      "https://gitlab.com.evil.example/john",
      "john?x=1",
      "john%2F..",
      "javascript:alert(1)",
      7,
    ]) {
      expect(normalizeLink("gitlab", v)).toBeNull();
    }
  });

  it("linkedin: slug or /in/ URL", () => {
    const expected = {
      kind: "linkedin",
      label: "john-doe-123",
      href: "https://www.linkedin.com/in/john-doe-123",
    };
    for (const v of [
      "john-doe-123",
      "linkedin.com/in/john-doe-123",
      "https://www.linkedin.com/in/john-doe-123/",
      "https://fr.linkedin.com/in/john-doe-123",
      "https://linkedin.com/in/john-doe-123?originalSubdomain=fr",
    ]) {
      expect(normalizeLink("linkedin", v)).toEqual(expected);
    }
    expect(normalizeLink("linkedin", "a".repeat(100))?.label).toHaveLength(100);
  });

  it("linkedin: rejects everything else", () => {
    for (const v of [
      "",
      "ab",
      "a".repeat(101),
      "john doe",
      "j\u00E9r\u00F4me-martin",
      "john.doe",
      "linkedin.com/company/acme",
      "https://www.linkedin.com/in/",
      "https://www.linkedin.com/in/john-doe/details/skills",
      "https://evil.example/in/john-doe",
      "https://linkedin.com.evil.example/in/john-doe",
      "javascript:alert(1)",
      [],
    ]) {
      expect(normalizeLink("linkedin", v)).toBeNull();
    }
  });

  it("website: normalised https URL, host name as label", () => {
    expect(normalizeLink("website", "https://example.com")).toEqual({
      kind: "website",
      label: "example.com",
      href: "https://example.com/",
    });
    expect(normalizeLink("website", "www.example.com/blog?p=1#top")).toEqual({
      kind: "website",
      label: "example.com",
      href: "https://www.example.com/blog?p=1#top",
    });
    expect(normalizeLink("website", "  example.com  ")?.href).toBe("https://example.com/");
    expect(normalizeLink("website", "example.com:8443/me")?.href).toBe(
      "https://example.com:8443/me",
    );
    expect(normalizeLink("website", "HTTPS://EXAMPLE.COM/Path")).toEqual({
      kind: "website",
      label: "example.com",
      href: "https://example.com/Path",
    });
    // IP addresses and punycode are fine as long as it is https
    expect(normalizeLink("website", "https://1.2.3.4/")?.label).toBe("1.2.3.4");
    expect(normalizeLink("website", "https://b\u00FCcher.example")).toEqual({
      kind: "website",
      label: "xn--bcher-kva.example",
      href: "https://xn--bcher-kva.example/",
    });
    // quotes and spaces are percent-encoded by the parser
    expect(normalizeLink("website", 'https://example.com/a"b c')?.href).toBe(
      "https://example.com/a%22b%20c",
    );
  });

  it("website: the label is the host the browser really opens", () => {
    for (const v of [
      "https://good.example\\@evil.example",
      "https://good.example/@evil.example",
      "https://good.example#@evil.example",
      "https://good.example?https://evil.example",
    ]) {
      const link = normalizeLink("website", v);
      if (!link) continue; // refusing is fine too
      expect(link.label).toBe("good.example");
      expect(new URL(link.href).hostname).toBe("good.example");
    }
  });

  it("website: rejects every other scheme", () => {
    for (const v of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      "\u0001javascript:alert(1)",
      "javascript://example.com/%0Aalert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "http://example.com",
      "http://",
      "ftp://example.com",
      "file:///etc/passwd",
      "blob:https://example.com/uuid",
      "chrome-extension://abcdef/page.html",
      "mailto:me@example.com",
      "ws://example.com",
      "https:example.com",
      "https:\\\\example.com",
      "//example.com",
    ]) {
      expect(normalizeLink("website", v)).toBeNull();
    }
  });

  it("website: rejects credentials, dotless hosts and oversized URLs", () => {
    for (const v of [
      "https://user:pass@evil.example",
      "https://user@evil.example",
      "https://paypal.com@evil.example/",
      "user:pass@evil.example",
      "paypal.com@evil.example",
      "https://localhost",
      "https://localhost:3000/",
      "https://intranet/",
      "https://[::1]/",
      "https://.com",
      "https://",
      "https://exa mple.com",
      "example",
      "my site is example.com",
      "",
      "   ",
      `https://example.com/${"a".repeat(200)}`,
      `https://${"a".repeat(60)}.${"b".repeat(60)}.example`,
      `https://example.com/${"a".repeat(600)}`,
      "https://example.com/it's",
      42,
      null,
      undefined,
      {},
    ]) {
      expect(normalizeLink("website", v)).toBeNull();
    }
    const longest = `https://example.com/${"a".repeat(180)}`;
    expect(longest).toHaveLength(200);
    expect(normalizeLink("website", longest)?.href).toBe(longest);
  });

  it("discord: a handle that is copied, never opened", () => {
    expect(normalizeLink("discord", "john_doe")).toEqual({
      kind: "discord",
      label: "john_doe",
      href: "",
    });
    expect(normalizeLink("discord", "@john.doe")?.label).toBe("john.doe");
    expect(normalizeLink("discord", "John#1234")?.label).toBe("John#1234");
    expect(normalizeLink("discord", "ab")?.label).toBe("ab");
    expect(normalizeLink("discord", "a".repeat(32))?.label).toHaveLength(32);
    for (const v of [
      "",
      "a",
      "@a",
      "@@john",
      "a".repeat(33),
      "john doe",
      "john#12",
      "john#12345",
      "john#abcd",
      "#1234",
      "john<b>",
      "https://discord.gg/abc",
      "javascript:alert(1)",
      12345,
    ]) {
      expect(normalizeLink("discord", v)).toBeNull();
    }
  });

  it("refuses a kind that is not in the contract", () => {
    expect(normalizeLink("twitter" as never, "john")).toBeNull();
    expect(normalizeLink("__proto__" as never, "john")).toBeNull();
  });

  it("is idempotent: the href (or the label) of a link gives the same link", () => {
    const inputs: Array<[Parameters<typeof normalizeLink>[0], string]> = [
      ["github", "@octocat"],
      ["gitlab", "gitlab.com/john.doe_1/"],
      ["linkedin", "https://fr.linkedin.com/in/john-doe-123/"],
      ["website", "www.example.com/a b"],
      ["discord", "@john#1234"],
    ];
    for (const [kind, value] of inputs) {
      const once = normalizeLink(kind, value);
      expect(once).not.toBeNull();
      expect(normalizeLink(kind, once!.href || once!.label)).toEqual(once);
    }
  });
});

describe("hasVisibleExtras", () => {
  it("is false for neutral extras, whatever the unused colours are", () => {
    expect(hasVisibleExtras(neutralExtras())).toBe(false);
    expect(
      hasVisibleExtras({
        ...neutralExtras(),
        nameColor: "#ff0000",
        nameColor2: "#00ff00",
        frameColor: "#ff0000",
        frameColor2: "#00ff00",
        levelColor: "#ff0000",
        levelColor2: "#00ff00",
        effectIntensity: "high",
        effectColor: "#123456",
      }),
    ).toBe(false);
  });

  it("is true as soon as one thing shows", () => {
    const changes: Array<Partial<ProfileExtras>> = [
      { bio: "hi" },
      { statusEmoji: "\u{1F525}" },
      { statusText: "busy" },
      { pronouns: "they/them" },
      { greeting: "welcome" },
      { flair: ["\u2B50"] },
      { links: [{ kind: "discord", label: "john", href: "" }] },
      { nameStyle: "rainbow" },
      { nameFont: "mono" },
      { frame: "solid" },
      { levelStyle: "striped" },
      { bannerGradient: "ocean" },
      { bannerDim: 1 },
      { bannerBlur: 1 },
      { cardGlow: true },
      { effect: "snow" },
    ];
    for (const change of changes) {
      expect(hasVisibleExtras({ ...neutralExtras(), ...change })).toBe(true);
    }
  });
});

describe("sanitizeProfileExtras", () => {
  it("returns null for anything that is not a plain object", () => {
    class Settings {
      PROFILE_PUB_BIO = "hi";
    }
    for (const v of [
      undefined,
      null,
      "x",
      42,
      true,
      [],
      [{ PROFILE_PUB_BIO: "hi" }],
      new Map([["PROFILE_PUB_BIO", "hi"]]),
      new Settings(),
      Object.create({ PROFILE_PUB_BIO: "inherited" }),
      () => ({}),
      JSON.stringify({ PROFILE_PUB_BIO: "hi" }),
    ]) {
      expect(sanitizeProfileExtras(v)).toBeNull();
    }
    const bare = Object.create(null) as Record<string, unknown>;
    bare.PROFILE_PUB_BIO = "hi";
    expect(sanitizeProfileExtras(bare)?.bio).toBe("hi");
    expect(sanitizeProfileExtras(JSON.parse('{"PROFILE_PUB_BIO":"hi"}'))?.bio).toBe("hi");
  });

  it("returns null when the owner switched publication off", () => {
    const raw = { ...defaultRaw(), PROFILE_PUB_BIO: "hi", PROFILE_PUB_FRAME: "neon" };
    expect(sanitizeProfileExtras({ ...raw, PROFILE_PUB_ENABLED: false })).toBeNull();
    // only a real `false` switches it off (the key is absent on old clients)
    expect(sanitizeProfileExtras({ ...raw, PROFILE_PUB_ENABLED: true })?.bio).toBe("hi");
    expect(sanitizeProfileExtras({ ...raw, PROFILE_PUB_ENABLED: undefined })?.bio).toBe("hi");
    expect(sanitizeProfileExtras({ ...raw, PROFILE_PUB_ENABLED: "false" })?.bio).toBe("hi");
    expect(sanitizeProfileExtras({ ...raw, PROFILE_PUB_ENABLED: 0 })?.bio).toBe("hi");
  });

  it("returns null when nothing visible remains", () => {
    expect(sanitizeProfileExtras({})).toBeNull();
    expect(sanitizeProfileExtras(defaultRaw())).toBeNull();
    // colours, intensity and tint alone show nothing
    expect(
      sanitizeProfileExtras({
        ...defaultRaw(),
        PROFILE_PUB_NAME_COLOR: "#ff0000",
        PROFILE_PUB_FRAME_COLOR: "#ff0000",
        PROFILE_PUB_LEVEL_COLOR_2: "#ff0000",
        PROFILE_PUB_EFFECT_INTENSITY: "high",
        PROFILE_PUB_EFFECT_TINT: true,
        PROFILE_PUB_EFFECT_COLOR: "#ff0000",
      }),
    ).toBeNull();
    // everything is rejected or cleaned away
    expect(
      sanitizeProfileExtras({
        PROFILE_PUB_BIO: " \u200B\u202E\n ",
        PROFILE_PUB_FLAIR: "abc <b>",
        PROFILE_PUB_LINK_WEBSITE: "javascript:alert(1)",
        PROFILE_PUB_NAME_STYLE: "blink",
        PROFILE_PUB_BANNER_GRADIENT: "constructor",
        PROFILE_PUB_BANNER_DIM: "lots",
        PROFILE_PUB_CARD_GLOW: "true",
        CUSTOM_CSS: "body { display: none }",
      }),
    ).toBeNull();
  });

  it("rebuilds a legitimate configuration", () => {
    const out = sanitizeProfileExtras({
      PROFILE_PUB_ENABLED: true,
      PROFILE_PUB_BIO: "  42 Mulhouse student,\nC and coffee  ",
      PROFILE_PUB_STATUS_EMOJI: "\u{1F525}",
      PROFILE_PUB_STATUS_TEXT: "minishell",
      PROFILE_PUB_PRONOUNS: "she/her",
      PROFILE_PUB_FLAIR: "\u{1F680} \u2728",
      PROFILE_PUB_GREETING: "Welcome!",
      PROFILE_PUB_LINK_GITHUB: "@octocat",
      PROFILE_PUB_LINK_GITLAB: "",
      PROFILE_PUB_LINK_LINKEDIN: "https://www.linkedin.com/in/john-doe-123/",
      PROFILE_PUB_LINK_WEBSITE: "example.com",
      PROFILE_PUB_LINK_DISCORD: "john_doe",
      PROFILE_PUB_NAME_STYLE: "gradient",
      PROFILE_PUB_NAME_COLOR: "#FF0000",
      PROFILE_PUB_NAME_COLOR_2: "#00ff00",
      PROFILE_PUB_NAME_FONT: "mono",
      PROFILE_PUB_FRAME: "neon",
      PROFILE_PUB_FRAME_COLOR: "#112233",
      PROFILE_PUB_FRAME_COLOR_2: "#445566",
      PROFILE_PUB_LEVEL_STYLE: "striped",
      PROFILE_PUB_LEVEL_COLOR: "#778899",
      PROFILE_PUB_LEVEL_COLOR_2: "#aabbcc",
      PROFILE_PUB_BANNER_GRADIENT: "ocean",
      PROFILE_PUB_BANNER_DIM: 40,
      PROFILE_PUB_BANNER_BLUR: 6,
      PROFILE_PUB_CARD_GLOW: true,
      PROFILE_PUB_EFFECT: "sakura",
      PROFILE_PUB_EFFECT_INTENSITY: "high",
      PROFILE_PUB_EFFECT_TINT: true,
      PROFILE_PUB_EFFECT_COLOR: "#ffccdd",
    });
    expect(out).toEqual({
      bio: "42 Mulhouse student, C and coffee",
      statusEmoji: "\u{1F525}",
      statusText: "minishell",
      pronouns: "she/her",
      flair: ["\u{1F680}", "\u2728"],
      greeting: "Welcome!",
      links: [
        { kind: "github", label: "octocat", href: "https://github.com/octocat" },
        {
          kind: "linkedin",
          label: "john-doe-123",
          href: "https://www.linkedin.com/in/john-doe-123",
        },
        { kind: "website", label: "example.com", href: "https://example.com/" },
        { kind: "discord", label: "john_doe", href: "" },
      ],
      nameStyle: "gradient",
      nameColor: "#FF0000",
      nameColor2: "#00ff00",
      nameFont: "mono",
      frame: "neon",
      frameColor: "#112233",
      frameColor2: "#445566",
      levelStyle: "striped",
      levelColor: "#778899",
      levelColor2: "#aabbcc",
      bannerGradient: "ocean",
      bannerDim: 40,
      bannerBlur: 6,
      cardGlow: true,
      effect: "sakura",
      effectIntensity: "high",
      effectColor: "#ffccdd",
    });
  });

  it("neutralises a hostile configuration", () => {
    const breakout = "red; } * { display:none";
    const out = sanitizeProfileExtras({
      PROFILE_PUB_BIO: `<img src=x onerror=alert(1)>\u202E${"A".repeat(500)}`,
      PROFILE_PUB_STATUS_EMOJI: "\u{1F600}".repeat(40),
      PROFILE_PUB_STATUS_TEXT: { toString: () => "x" },
      PROFILE_PUB_PRONOUNS: ["she/her"],
      PROFILE_PUB_FLAIR: "<script> \u{1F525} javascript:alert(1)",
      PROFILE_PUB_GREETING: 42,
      PROFILE_PUB_LINK_GITHUB: "https://evil.example/octocat",
      PROFILE_PUB_LINK_GITLAB: "../../admin",
      PROFILE_PUB_LINK_LINKEDIN: "javascript:alert(1)",
      PROFILE_PUB_LINK_WEBSITE: "https://user:pass@evil.example",
      PROFILE_PUB_LINK_DISCORD: "john<script>",
      PROFILE_PUB_NAME_STYLE: "gradient; } body { display:none",
      PROFILE_PUB_NAME_COLOR: breakout,
      PROFILE_PUB_NAME_COLOR_2: "#fff",
      PROFILE_PUB_NAME_FONT: "Comic Sans MS'; } * { color: red",
      PROFILE_PUB_FRAME: "toString",
      PROFILE_PUB_FRAME_COLOR: "url(https://evil.example/x)",
      PROFILE_PUB_FRAME_COLOR_2: "#12345g",
      PROFILE_PUB_LEVEL_STYLE: 3,
      PROFILE_PUB_LEVEL_COLOR: "#11223344",
      PROFILE_PUB_LEVEL_COLOR_2: null,
      PROFILE_PUB_BANNER_GRADIENT: "__proto__",
      PROFILE_PUB_BANNER_DIM: 9999,
      PROFILE_PUB_BANNER_BLUR: -50,
      PROFILE_PUB_CARD_GLOW: 1,
      PROFILE_PUB_EFFECT: "fork-bomb",
      PROFILE_PUB_EFFECT_INTENSITY: "ludicrous",
      PROFILE_PUB_EFFECT_TINT: true,
      PROFILE_PUB_EFFECT_COLOR: breakout,
      // never part of the extras, whatever the server sends
      CUSTOM_CSS: "body { display: none }",
    });
    expect(out).not.toBeNull();
    const x = out!;
    // text is kept as text (it is rendered through text bindings), but capped
    expect(Array.from(x.bio)).toHaveLength(LIMITS.bio);
    expect(x.bio.startsWith("<img src=x onerror=alert(1)>AAAA")).toBe(true);
    expect(x.bio).not.toContain("\u202E");
    expect(x.statusEmoji).toBe("\u{1F600}".repeat(LIMITS.statusEmoji));
    expect(x.statusText).toBe("");
    expect(x.pronouns).toBe("");
    expect(x.greeting).toBe("");
    expect(x.flair).toEqual(["\u{1F525}"]);
    expect(x.links).toEqual([]);
    expect(x.nameStyle).toBe("default");
    expect(x.nameFont).toBe("default");
    expect(x.frame).toBe("none");
    expect(x.levelStyle).toBe("default");
    expect(x.nameColor).toBe(CONFIG_DEFAULT.PROFILE_PUB_NAME_COLOR);
    expect(x.nameColor2).toBe(CONFIG_DEFAULT.PROFILE_PUB_NAME_COLOR_2);
    expect(x.frameColor).toBe(CONFIG_DEFAULT.PROFILE_PUB_FRAME_COLOR);
    expect(x.frameColor2).toBe(CONFIG_DEFAULT.PROFILE_PUB_FRAME_COLOR_2);
    expect(x.levelColor).toBe(CONFIG_DEFAULT.PROFILE_PUB_LEVEL_COLOR);
    expect(x.levelColor2).toBe(CONFIG_DEFAULT.PROFILE_PUB_LEVEL_COLOR_2);
    expect(x.bannerGradient).toBe("none");
    expect(x.bannerDim).toBe(LIMITS.bannerDimMax);
    expect(x.bannerBlur).toBe(0);
    expect(x.cardGlow).toBe(false);
    expect(x.effect).toBe("none");
    expect(x.effectIntensity).toBe("medium");
    expect(x.effectColor).toBe("");
    // nothing but the contract's keys comes out
    expect(Object.keys(x).sort()).toEqual(Object.keys(neutralExtras()).sort());
  });

  it("every colour that comes out is a strict #rrggbb", () => {
    const hostile = [
      "red; } * { display:none",
      "#fff",
      "#ffffff80",
      "rgb(0,0,0)",
      "#ffffff;",
      "expression(alert(1))",
      "",
      0xffffff,
      null,
      ["#ffffff"],
    ];
    for (const value of hostile) {
      const x = sanitizeProfileExtras({
        PROFILE_PUB_FRAME: "solid",
        PROFILE_PUB_NAME_COLOR: value,
        PROFILE_PUB_NAME_COLOR_2: value,
        PROFILE_PUB_FRAME_COLOR: value,
        PROFILE_PUB_FRAME_COLOR_2: value,
        PROFILE_PUB_LEVEL_COLOR: value,
        PROFILE_PUB_LEVEL_COLOR_2: value,
        PROFILE_PUB_EFFECT_TINT: true,
        PROFILE_PUB_EFFECT_COLOR: value,
      })!;
      for (const c of [x.nameColor, x.nameColor2, x.frameColor, x.frameColor2, x.levelColor, x.levelColor2]) {
        expect(c).toMatch(HEX);
      }
      expect(x.effectColor).toBe("");
    }
    // surrounding spaces are tolerated, the value that comes out has none
    expect(
      sanitizeProfileExtras({ PROFILE_PUB_FRAME: "solid", PROFILE_PUB_FRAME_COLOR: " #ABCDEF " })
        ?.frameColor,
    ).toBe("#ABCDEF");
  });

  it("only takes the effect tint when the owner asked for one", () => {
    const base = { PROFILE_PUB_EFFECT: "snow", PROFILE_PUB_EFFECT_COLOR: "#ff00ff" };
    expect(sanitizeProfileExtras({ ...base, PROFILE_PUB_EFFECT_TINT: true })?.effectColor).toBe(
      "#ff00ff",
    );
    expect(sanitizeProfileExtras({ ...base, PROFILE_PUB_EFFECT_TINT: false })?.effectColor).toBe("");
    expect(sanitizeProfileExtras({ ...base, PROFILE_PUB_EFFECT_TINT: "true" })?.effectColor).toBe("");
    expect(sanitizeProfileExtras({ ...base, PROFILE_PUB_EFFECT_TINT: 1 })?.effectColor).toBe("");
    expect(sanitizeProfileExtras(base)?.effectColor).toBe("");
    expect(
      sanitizeProfileExtras({
        PROFILE_PUB_EFFECT: "snow",
        PROFILE_PUB_EFFECT_TINT: true,
        PROFILE_PUB_EFFECT_COLOR: "pink",
      })?.effectColor,
    ).toBe("");
  });

  it("rounds and clamps numbers, numeric strings included", () => {
    const dim = (v: unknown) =>
      sanitizeProfileExtras({ PROFILE_PUB_FRAME: "solid", PROFILE_PUB_BANNER_DIM: v })!.bannerDim;
    const blur = (v: unknown) =>
      sanitizeProfileExtras({ PROFILE_PUB_FRAME: "solid", PROFILE_PUB_BANNER_BLUR: v })!.bannerBlur;
    expect(dim(55)).toBe(55);
    expect(dim("55")).toBe(55);
    expect(dim(" 55 ")).toBe(55);
    expect(dim("54.6")).toBe(55);
    expect(dim(3.4)).toBe(3);
    expect(dim(999)).toBe(LIMITS.bannerDimMax);
    expect(dim("999")).toBe(LIMITS.bannerDimMax);
    expect(dim(-5)).toBe(0);
    expect(dim("-5")).toBe(0);
    expect(Object.is(dim(-0.2), 0)).toBe(true); // not -0
    for (const v of [NaN, Infinity, -Infinity, "abc", "", " ", "0x37", "1e1", "5px", "5;", "9".repeat(400), true, null, undefined, [5], { valueOf: () => 5 }]) {
      expect(dim(v)).toBe(0);
    }
    expect(blur(7)).toBe(7);
    expect(blur("7.4")).toBe(7);
    expect(blur(99)).toBe(LIMITS.bannerBlurMax);
    expect(blur(-1)).toBe(0);
    expect(blur("blur(99px)")).toBe(0);
  });

  it("only === true counts for booleans", () => {
    expect(sanitizeProfileExtras({ PROFILE_PUB_CARD_GLOW: true })?.cardGlow).toBe(true);
    for (const v of ["true", 1, "1", {}, [], "yes"]) {
      expect(sanitizeProfileExtras({ PROFILE_PUB_CARD_GLOW: v })).toBeNull();
    }
  });

  it("falls back to the neutral value for unknown enum values", () => {
    const x = sanitizeProfileExtras({
      PROFILE_PUB_BIO: "hi",
      PROFILE_PUB_NAME_STYLE: "RAINBOW",
      PROFILE_PUB_NAME_FONT: " mono",
      PROFILE_PUB_FRAME: "constructor",
      PROFILE_PUB_LEVEL_STYLE: "hasOwnProperty",
      PROFILE_PUB_EFFECT: "length",
      PROFILE_PUB_EFFECT_INTENSITY: "0",
    })!;
    expect(x.nameStyle).toBe("default");
    expect(x.nameFont).toBe("default");
    expect(x.frame).toBe("none");
    expect(x.levelStyle).toBe("default");
    expect(x.effect).toBe("none");
    expect(x.effectIntensity).toBe("medium");
  });

  it("only accepts own keys of BG_PRESETS as banner gradient", () => {
    const gradient = (v: unknown) =>
      sanitizeProfileExtras({ PROFILE_PUB_BIO: "hi", PROFILE_PUB_BANNER_GRADIENT: v })!
        .bannerGradient;
    expect(gradient("aurora")).toBe("aurora");
    expect(gradient("mesh")).toBe("mesh");
    expect(gradient("none")).toBe("none");
    for (const v of [
      "constructor",
      "__proto__",
      "prototype",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "Aurora",
      "aurora ",
      "linear-gradient(red, blue)",
      "url(https://evil.example/x.png)",
      "",
      0,
      null,
      ["aurora"],
    ]) {
      expect(gradient(v)).toBe("none");
    }
  });

  it("lists the links in a fixed order and skips the invalid ones", () => {
    const x = sanitizeProfileExtras({
      PROFILE_PUB_LINK_DISCORD: "john_doe",
      PROFILE_PUB_LINK_WEBSITE: "http://example.com", // not https
      PROFILE_PUB_LINK_LINKEDIN: "john-doe-123",
      PROFILE_PUB_LINK_GITLAB: "john",
      PROFILE_PUB_LINK_GITHUB: "-nope-",
    })!;
    expect(x.links.map((l) => l.kind)).toEqual(["gitlab", "linkedin", "discord"]);
    const all = sanitizeProfileExtras({
      PROFILE_PUB_LINK_DISCORD: "john_doe",
      PROFILE_PUB_LINK_WEBSITE: "example.com",
      PROFILE_PUB_LINK_LINKEDIN: "john-doe-123",
      PROFILE_PUB_LINK_GITLAB: "john",
      PROFILE_PUB_LINK_GITHUB: "john",
    })!;
    expect(all.links.map((l) => l.kind)).toEqual([
      "github",
      "gitlab",
      "linkedin",
      "website",
      "discord",
    ]);
    for (const link of all.links) {
      if (link.kind === "discord") expect(link.href).toBe("");
      else expect(new URL(link.href).protocol).toBe("https:");
    }
  });

  it("caps every text field", () => {
    const long = "\u00E9".repeat(500);
    const x = sanitizeProfileExtras({
      PROFILE_PUB_BIO: long,
      PROFILE_PUB_STATUS_EMOJI: long,
      PROFILE_PUB_STATUS_TEXT: long,
      PROFILE_PUB_PRONOUNS: long,
      PROFILE_PUB_GREETING: long,
    })!;
    expect(x.bio).toHaveLength(LIMITS.bio);
    expect(x.statusEmoji).toHaveLength(LIMITS.statusEmoji);
    expect(x.statusText).toHaveLength(LIMITS.statusText);
    expect(x.pronouns).toHaveLength(LIMITS.pronouns);
    expect(x.greeting).toHaveLength(LIMITS.greeting);
    // a surrogate pair sitting on the limit is kept whole or not at all
    const onTheCut = sanitizeProfileExtras({
      PROFILE_PUB_BIO: `${"a".repeat(LIMITS.bio - 1)}\u{1F600}\u{1F600}`,
    })!;
    expect(onTheCut.bio).toBe(`${"a".repeat(LIMITS.bio - 1)}\u{1F600}`);
  });

  it("ignores a \"__proto__\" key smuggled through JSON", () => {
    // JSON.parse makes it an OWN property: the prototype is not replaced
    const raw = JSON.parse(
      '{"PROFILE_PUB_FRAME":"solid","__proto__":{"PROFILE_PUB_GREETING":"inherited","PROFILE_PUB_ENABLED":false}}',
    );
    const x = sanitizeProfileExtras(raw);
    expect(x).toEqual({ ...neutralExtras(), frame: "solid" });
    expect(({} as Record<string, unknown>).PROFILE_PUB_GREETING).toBeUndefined();
    // an object that really inherits its values is refused as a whole
    expect(
      sanitizeProfileExtras({ __proto__: { PROFILE_PUB_GREETING: "inherited" }, PROFILE_PUB_BIO: "hi" }),
    ).toBeNull();
  });

  it("ignores values inherited from a polluted Object.prototype", () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto.PROFILE_PUB_BIO = "polluted";
    proto.PROFILE_PUB_ENABLED = false;
    try {
      const x = sanitizeProfileExtras({ PROFILE_PUB_FRAME: "solid" });
      expect(x).not.toBeNull();
      expect(x!.bio).toBe("");
    } finally {
      delete proto.PROFILE_PUB_BIO;
      delete proto.PROFILE_PUB_ENABLED;
    }
  });

  it("reads the owner's settings straight from chrome.storage", async () => {
    await chrome.storage.local.set({
      PROFILE_PUB_BIO: "from storage",
      PROFILE_PUB_BANNER_DIM: "30",
    });
    // keys that were never saved come back undefined
    const raw = await chrome.storage.local.get([...EXTRAS_KEYS]);
    const x = sanitizeProfileExtras(raw);
    expect(x).toEqual({ ...neutralExtras(), bio: "from storage", bannerDim: 30 });
    await chrome.storage.local.remove(["PROFILE_PUB_BIO", "PROFILE_PUB_BANNER_DIM"]);
  });

  it("is idempotent: the owner's configuration sanitised twice gives the same result", () => {
    const owner = {
      ...defaultRaw(),
      PROFILE_PUB_BIO: `  e\u0301tudiant \u202E 42\n${"\u{1F600}".repeat(200)}`,
      PROFILE_PUB_STATUS_EMOJI: "\u{1F468}\u200D\u{1F4BB}",
      PROFILE_PUB_STATUS_TEXT: "  in   the  zone ",
      PROFILE_PUB_PRONOUNS: "they/them",
      PROFILE_PUB_FLAIR: "\u{1F525}  abc \u{1F680}\n\u2728 \u2605 \u2B50 \u2764\uFE0F \u{1F308} \u{1F47E}",
      PROFILE_PUB_GREETING: "Bienvenue !",
      PROFILE_PUB_LINK_GITHUB: "https://github.com/octocat/",
      PROFILE_PUB_LINK_GITLAB: "@john.doe",
      PROFILE_PUB_LINK_LINKEDIN: "fr.linkedin.com/in/john-doe-123",
      PROFILE_PUB_LINK_WEBSITE: "www.example.com/my page",
      PROFILE_PUB_LINK_DISCORD: "@john#1234",
      PROFILE_PUB_NAME_STYLE: "neon",
      PROFILE_PUB_NAME_COLOR: " #FF00FF ",
      PROFILE_PUB_FRAME: "double",
      PROFILE_PUB_LEVEL_STYLE: "gradient",
      PROFILE_PUB_BANNER_GRADIENT: "lava",
      PROFILE_PUB_BANNER_DIM: "33.5",
      PROFILE_PUB_BANNER_BLUR: 40,
      PROFILE_PUB_CARD_GLOW: true,
      PROFILE_PUB_EFFECT: "fireflies",
      PROFILE_PUB_EFFECT_INTENSITY: "low",
      PROFILE_PUB_EFFECT_TINT: true,
      PROFILE_PUB_EFFECT_COLOR: "#ABCDEF",
    };
    const once = sanitizeProfileExtras(owner);
    expect(once).not.toBeNull();
    // same input, same output (and no shared mutable state between calls)
    const again = sanitizeProfileExtras(owner);
    expect(again).toEqual(once);
    expect(again!.links).not.toBe(once!.links);
    expect(again!.flair).not.toBe(once!.flair);
    // and a configuration rebuilt from the result is a fixed point
    const twice = sanitizeProfileExtras(toRaw(once!));
    expect(twice).toEqual(once);
    expect(sanitizeProfileExtras(toRaw(twice!))).toEqual(once);
    // the input was not modified
    expect(owner.PROFILE_PUB_NAME_COLOR).toBe(" #FF00FF ");
  });
});
