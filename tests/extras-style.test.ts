import { describe, it, expect } from "vitest";
import { buildExtrasCss } from "../src/features/profile/extras/extras-style";
import {
  FRAMES,
  LEVEL_FILL_SELECTOR,
  LEVEL_STYLES,
  LIMITS,
  NAME_FONTS,
  NAME_SELECTOR,
  NAME_STYLES,
  PROFILE_CARD,
  type Frame,
  type LevelStyle,
  type NameFont,
  type NameStyle,
  type ProfileExtras,
} from "../src/features/profile/extras/extras";
import {
  AVATAR_SELECTOR,
  BACKGROUND_SELECTOR,
  BANNER_SELECTOR,
} from "../src/core/intra/selectors";
import { BG_PRESETS, FONT_PRESETS } from "../src/features/customize/customize";

/** Extras that change nothing on the page. */
const neutral = (over: Partial<ProfileExtras> = {}): ProfileExtras => ({
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
  ...over,
});

const HOSTILE_COLOURS = ["#fff; } body{display:none", "red"];
/** Fragments of the hostile values that no legitimate rule contains. */
const expectNoInjection = (css: string) => {
  expect(css).not.toContain("display:none");
  expect(css).not.toContain("body");
  expect(css).not.toContain("#fff;");
};

const count = (css: string, needle: string) => css.split(needle).length - 1;

/** Loose parse check: braces balanced and never closing more than opened. */
const expectBalanced = (css: string) => {
  let depth = 0;
  for (const ch of css) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    expect(depth).toBeGreaterThanOrEqual(0);
  }
  expect(depth).toBe(0);
};

describe("buildExtrasCss: neutral values", () => {
  it("is empty for neutral extras", () => {
    expect(buildExtrasCss(neutral())).toBe("");
    expect(buildExtrasCss(neutral(), { hasBackgroundImage: true })).toBe("");
  });

  it("ignores the identity and effect parts", () => {
    expect(
      buildExtrasCss(
        neutral({
          bio: "hello } body { display:none",
          statusText: "busy",
          flair: ["x"],
          greeting: "hi",
          links: [{ kind: "github", label: "me", href: "https://github.com/me" }],
          effect: "snow",
          effectIntensity: "high",
          effectColor: "#ff0000",
        }),
      ),
    ).toBe("");
  });

  it("is empty when the colours differ but every style is neutral", () => {
    expect(
      buildExtrasCss(
        neutral({ nameColor: "#ff0000", frameColor: "#ff0000", levelColor: "#ff0000" }),
      ),
    ).toBe("");
  });

  it("survives a missing object", () => {
    expect(buildExtrasCss(null as unknown as ProfileExtras)).toBe("");
    expect(buildExtrasCss(undefined as unknown as ProfileExtras)).toBe("");
  });
});

describe("buildExtrasCss: name", () => {
  const SEL = `html ${NAME_SELECTOR} {`;

  it("accent uses the viewer's primary colour", () => {
    const css = buildExtrasCss(neutral({ nameStyle: "accent" }));
    expect(css).toContain(SEL);
    expect(css).toContain("color: hsl(var(--primary)) !important");
    expect(css).not.toContain("#00babc");
  });

  it("custom uses nameColor only", () => {
    const css = buildExtrasCss(neutral({ nameStyle: "custom", nameColor: "#ff8800" }));
    expect(css).toBe(`html ${NAME_SELECTOR} { color: #ff8800 !important; }`);
  });

  it("gradient is clipped to the text and drops the text-shadow", () => {
    const css = buildExtrasCss(
      neutral({ nameStyle: "gradient", nameColor: "#ff0000", nameColor2: "#0000ff" }),
    );
    expect(css).toContain("background-image: linear-gradient(90deg, #ff0000, #0000ff) !important");
    expect(css).toContain("-webkit-background-clip: text !important");
    expect(css).toContain("background-clip: text !important");
    expect(css).toContain("-webkit-text-fill-color: transparent !important");
    expect(css).toContain("color: transparent !important");
    expect(css).toContain("text-shadow: none !important");
    expect(css).not.toContain("@keyframes");
    expect(css).not.toContain("animation");
  });

  it("rainbow is an animated gradient clipped to the text", () => {
    const css = buildExtrasCss(neutral({ nameStyle: "rainbow" }));
    expect(css).toContain("@keyframes ft-px-rainbow");
    expect(css).toContain("background-size: 300% 100% !important");
    expect(css).toContain("animation: ft-px-rainbow");
    expect(css).toContain("background-clip: text !important");
    expect(css).toContain("text-shadow: none !important");
    // the owner's colours play no part
    expect(css).not.toContain("#00babc");
  });

  it("glow colours the text and adds a shadow in the same colour", () => {
    const css = buildExtrasCss(neutral({ nameStyle: "glow", nameColor: "#12ab34" }));
    expect(css).toContain("color: #12ab34 !important");
    expect(css).toMatch(/text-shadow: [^;]*#12ab34[^;]* !important/);
    expect(css).not.toContain("background-clip");
  });

  it("neon layers both colours around near-white text", () => {
    const css = buildExtrasCss(
      neutral({ nameStyle: "neon", nameColor: "#ff00aa", nameColor2: "#00aaff" }),
    );
    expect(css).toMatch(/color: #fff[0-9a-f]{3} !important/);
    expect(css).toMatch(/text-shadow: [^;]*#ff00aa[^;]*#00aaff[^;]* !important/);
  });

  it("emits nothing for the name when the style is default", () => {
    const css = buildExtrasCss(neutral({ cardGlow: true }));
    expect(css).not.toContain(NAME_SELECTOR);
  });

  it("maps every font preset to its constant family", () => {
    for (const font of NAME_FONTS) {
      const css = buildExtrasCss(neutral({ nameFont: font }));
      if (font === "default") {
        expect(css).toBe("");
      } else {
        expect(css).toBe(
          `html ${NAME_SELECTOR} { font-family: ${FONT_PRESETS[font]} !important; }`,
        );
      }
    }
  });

  it("never writes an unknown font", () => {
    for (const font of ["constructor", "__proto__", "toString", "Comic Sans; } body{display:none"]) {
      const css = buildExtrasCss(neutral({ nameFont: font as NameFont }));
      expect(css).toBe("");
    }
  });

  it("ignores an unknown name style", () => {
    const css = buildExtrasCss(
      neutral({ nameStyle: "custom; } body{display:none" as NameStyle }),
    );
    expect(css).toBe("");
  });
});

describe("buildExtrasCss: avatar frame", () => {
  const SEL = `html ${AVATAR_SELECTOR} {`;
  const RING = `html ${AVATAR_SELECTOR}::before {`;

  it("solid is a single ring", () => {
    const css = buildExtrasCss(neutral({ frame: "solid", frameColor: "#abcdef" }));
    expect(css).toBe(`${SEL} box-shadow: 0 0 0 4px #abcdef !important; }`);
  });

  it("double is two rings with a dark gap", () => {
    const css = buildExtrasCss(
      neutral({ frame: "double", frameColor: "#111111", frameColor2: "#222222" }),
    );
    expect(css).toMatch(
      /box-shadow: [^;]*#111111[^;]*rgba\(0,0,0,0\.6\)[^;]*#222222 !important/,
    );
    expect(css).not.toContain("::before");
  });

  it("dashed is an offset outline", () => {
    const css = buildExtrasCss(neutral({ frame: "dashed", frameColor: "#abcdef" }));
    expect(css).toContain("outline: 3px dashed #abcdef !important");
    expect(css).toContain("outline-offset: 4px !important");
    expect(css).not.toContain("box-shadow");
  });

  it("glow is a ring plus a blurred shadow", () => {
    const css = buildExtrasCss(neutral({ frame: "glow", frameColor: "#abcdef" }));
    expect(css).toMatch(/box-shadow: 0 0 0 3px #abcdef, [^;]*#abcdef !important/);
  });

  it("neon uses both colours", () => {
    const css = buildExtrasCss(
      neutral({ frame: "neon", frameColor: "#111111", frameColor2: "#222222" }),
    );
    expect(css).toMatch(/box-shadow: [^;]*#111111[^;]*#111111[^;]*#222222 !important/);
  });

  it("gradient paints a masked ::before ring and leaves ::after alone", () => {
    const css = buildExtrasCss(
      neutral({ frame: "gradient", frameColor: "#111111", frameColor2: "#222222" }),
    );
    expect(css).toContain(SEL);
    expect(css).toContain("position: relative !important");
    expect(css).toContain("overflow: visible !important");
    expect(css).toContain(RING);
    expect(css).toContain('content: "" !important');
    expect(css).toContain("inset: -6px !important");
    expect(css).toContain("padding: 6px !important");
    expect(css).toContain("border-radius: inherit !important");
    expect(css).toContain("pointer-events: none !important");
    expect(css).toMatch(/background: linear-gradient\([^;]*#111111, #222222\) !important/);
    expect(css).toContain("-webkit-mask-composite: xor !important");
    expect(css).toContain("mask-composite: exclude !important");
    expect(css).not.toContain("::after");
    expect(css).not.toContain("animation");
  });

  it("rainbow is a conic ring animated with hue-rotate", () => {
    const css = buildExtrasCss(neutral({ frame: "rainbow" }));
    expect(css).toContain(RING);
    expect(css).toContain("conic-gradient(");
    expect(css).toContain("@keyframes ft-px-hue");
    expect(css).toContain("hue-rotate(360deg)");
    expect(css).toContain("animation: ft-px-hue");
    expect(css).not.toContain("::after");
    // the hue animation is on the ring, never on the picture itself
    expect(css).toContain(
      `@media (prefers-reduced-motion: reduce) { html ${AVATAR_SELECTOR}::before { animation: none !important; } }`,
    );
  });

  it("emits nothing for the avatar without a frame", () => {
    const css = buildExtrasCss(neutral({ nameStyle: "accent", frame: "none" }));
    expect(css).not.toContain(AVATAR_SELECTOR);
  });

  it("ignores an unknown frame", () => {
    expect(buildExtrasCss(neutral({ frame: "constructor" as Frame }))).toBe("");
  });
});

describe("buildExtrasCss: level bar", () => {
  const SEL = `html ${LEVEL_FILL_SELECTOR} {`;

  it("custom replaces the fill colour and clears any gradient", () => {
    const css = buildExtrasCss(neutral({ levelStyle: "custom", levelColor: "#fedcba" }));
    expect(css).toBe(
      `${SEL} background-color: #fedcba !important; background-image: none !important; }`,
    );
  });

  it("gradient goes from levelColor to levelColor2", () => {
    const css = buildExtrasCss(
      neutral({ levelStyle: "gradient", levelColor: "#111111", levelColor2: "#222222" }),
    );
    expect(css).toContain(SEL);
    expect(css).toContain(
      "background-image: linear-gradient(90deg, #111111, #222222) !important",
    );
    expect(css).not.toContain("animation");
  });

  it("rainbow reuses the ft-px-rainbow animation", () => {
    const css = buildExtrasCss(neutral({ levelStyle: "rainbow" }));
    expect(css).toContain(SEL);
    expect(css).toContain("@keyframes ft-px-rainbow");
    expect(css).toContain("background-size: 300% 100% !important");
    expect(css).toContain("animation: ft-px-rainbow");
    // not the text variant
    expect(css).not.toContain("background-clip");
  });

  it("striped animates diagonal stripes over levelColor", () => {
    const css = buildExtrasCss(neutral({ levelStyle: "striped", levelColor: "#fedcba" }));
    expect(css).toContain("background-color: #fedcba !important");
    expect(css).toContain("repeating-linear-gradient(45deg, rgba(255,255,255,0.18)");
    expect(css).toContain("@keyframes ft-px-stripes");
    expect(css).toContain("background-position");
    expect(css).toContain("animation: ft-px-stripes");
  });

  it("emits nothing for the bar when the style is default", () => {
    const css = buildExtrasCss(neutral({ nameStyle: "accent" }));
    expect(css).not.toContain("progressbar");
  });

  it("ignores an unknown level style", () => {
    expect(buildExtrasCss(neutral({ levelStyle: "__proto__" as LevelStyle }))).toBe("");
  });
});

describe("buildExtrasCss: header backdrop, card blur and glow", () => {
  const BACKDROP = `html ${BACKGROUND_SELECTOR} {`;

  it("paints a known gradient preset on the backdrop", () => {
    const css = buildExtrasCss(neutral({ bannerGradient: "ocean" }));
    expect(css).toBe(`${BACKDROP} background: ${BG_PRESETS.ocean} !important; }`);
  });

  it("knows every preset of customize.ts", () => {
    for (const key of Object.keys(BG_PRESETS)) {
      const css = buildExtrasCss(neutral({ bannerGradient: key }));
      if (key === "none") expect(css).toBe("");
      else expect(css).toContain(`background: ${BG_PRESETS[key]} !important`);
      expectBalanced(css);
    }
  });

  it("keeps the owner's picture: no gradient when there is a background image", () => {
    const css = buildExtrasCss(neutral({ bannerGradient: "ocean" }), {
      hasBackgroundImage: true,
    });
    expect(css).toBe("");
  });

  it("still dims the picture when there is a background image", () => {
    const css = buildExtrasCss(neutral({ bannerGradient: "ocean", bannerDim: 40 }), {
      hasBackgroundImage: true,
    });
    expect(css).toBe(
      `${BACKDROP} box-shadow: inset 0 0 0 9999px rgba(0,0,0,0.4) !important; }`,
    );
  });

  it("skips unknown and prototype keys", () => {
    for (const key of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "nope",
      "",
      "url(https://evil.example/x.png)",
      "ocean; } body{display:none",
    ]) {
      const css = buildExtrasCss(neutral({ bannerGradient: key }));
      expect(css).toBe("");
    }
    expect(
      buildExtrasCss(neutral({ bannerGradient: 42 as unknown as string })),
    ).toBe("");
    expect(
      buildExtrasCss(neutral({ bannerGradient: ["ocean"] as unknown as string })),
    ).toBe("");
  });

  it("dims with an inset shadow, without pseudo-elements", () => {
    const css = buildExtrasCss(neutral({ bannerDim: 55 }));
    expect(css).toBe(
      `${BACKDROP} box-shadow: inset 0 0 0 9999px rgba(0,0,0,0.55) !important; }`,
    );
    expect(css).not.toContain("::");
  });

  it("clamps and rounds the dim again", () => {
    const max = LIMITS.bannerDimMax / 100;
    expect(buildExtrasCss(neutral({ bannerDim: 5000 }))).toContain(`rgba(0,0,0,${max})`);
    expect(buildExtrasCss(neutral({ bannerDim: Infinity }))).toBe("");
    expect(buildExtrasCss(neutral({ bannerDim: 12.4 }))).toContain("rgba(0,0,0,0.12)");
    expect(buildExtrasCss(neutral({ bannerDim: -20 }))).toBe("");
    expect(buildExtrasCss(neutral({ bannerDim: NaN }))).toBe("");
    expect(
      buildExtrasCss(neutral({ bannerDim: "40); } body{display:none" as unknown as number })),
    ).toBe("");
  });

  it("blurs what is behind the card", () => {
    const css = buildExtrasCss(neutral({ bannerBlur: 6 }));
    expect(css).toContain(`html ${BANNER_SELECTOR} {`);
    expect(css).toContain("backdrop-filter: blur(6px) !important");
    expect(css).toContain("-webkit-backdrop-filter: blur(6px) !important");
  });

  it("clamps and rounds the blur again", () => {
    expect(buildExtrasCss(neutral({ bannerBlur: 999 }))).toContain(
      `blur(${LIMITS.bannerBlurMax}px)`,
    );
    expect(buildExtrasCss(neutral({ bannerBlur: 3.6 }))).toContain("blur(4px)");
    expect(buildExtrasCss(neutral({ bannerBlur: -3 }))).toBe("");
    expect(buildExtrasCss(neutral({ bannerBlur: NaN }))).toBe("");
    expect(
      buildExtrasCss(neutral({ bannerBlur: "4px); } body{display:none" as unknown as number })),
    ).toBe("");
  });

  it("no blur or dim rule at zero", () => {
    const css = buildExtrasCss(neutral({ cardGlow: true }));
    expect(css).not.toContain("backdrop-filter");
    expect(css).not.toContain("inset");
  });

  it("card glow is permanent and follows the profile colour", () => {
    const css = buildExtrasCss(neutral({ cardGlow: true }));
    expect(css).toBe(
      `html ${PROFILE_CARD} { border-color: var(--user-color, hsl(var(--primary))) !important; box-shadow: 0 0 24px var(--user-color-translucent, rgba(0,186,188,0.25)) !important; }`,
    );
  });

  it("card glow needs a real boolean", () => {
    expect(buildExtrasCss(neutral({ cardGlow: "yes" as unknown as boolean }))).toBe("");
  });
});

describe("buildExtrasCss: hostile colours", () => {
  it("produce no rule at all, whatever the style", () => {
    for (const bad of HOSTILE_COLOURS) {
      for (const nameStyle of ["custom", "gradient", "glow", "neon"] as const) {
        const css = buildExtrasCss(
          neutral({ nameStyle, nameColor: bad, nameColor2: bad }),
        );
        expect(css).toBe("");
      }
      for (const frame of ["solid", "double", "dashed", "gradient", "glow", "neon"] as const) {
        const css = buildExtrasCss(
          neutral({ frame, frameColor: bad, frameColor2: bad }),
        );
        expect(css).toBe("");
      }
      for (const levelStyle of ["custom", "gradient", "striped"] as const) {
        const css = buildExtrasCss(
          neutral({ levelStyle, levelColor: bad, levelColor2: bad }),
        );
        expect(css).toBe("");
      }
    }
  });

  it("a hostile second colour drops the two-colour rules", () => {
    for (const bad of HOSTILE_COLOURS) {
      expect(buildExtrasCss(neutral({ nameStyle: "gradient", nameColor2: bad }))).toBe("");
      expect(buildExtrasCss(neutral({ nameStyle: "neon", nameColor2: bad }))).toBe("");
      expect(buildExtrasCss(neutral({ frame: "double", frameColor2: bad }))).toBe("");
      expect(buildExtrasCss(neutral({ frame: "gradient", frameColor2: bad }))).toBe("");
      expect(buildExtrasCss(neutral({ frame: "neon", frameColor2: bad }))).toBe("");
      expect(buildExtrasCss(neutral({ levelStyle: "gradient", levelColor2: bad }))).toBe("");
    }
  });

  it("never reach the output next to legitimate rules", () => {
    for (const bad of HOSTILE_COLOURS) {
      const css = buildExtrasCss(
        neutral({
          nameStyle: "gradient",
          nameColor: bad,
          nameColor2: "#123456",
          nameFont: "mono",
          frame: "neon",
          frameColor: "#123456",
          frameColor2: bad,
          levelStyle: "striped",
          levelColor: bad,
          bannerGradient: "ocean",
          bannerDim: 30,
          bannerBlur: 4,
          cardGlow: true,
        }),
      );
      // what is legitimate is still there...
      expect(css).toContain("font-family:");
      expect(css).toContain(`background: ${BG_PRESETS.ocean} !important`);
      expect(css).toContain("blur(4px)");
      // ...and nothing else
      expectNoInjection(css);
      expect(css).not.toContain("#123456");
      expect(css).not.toContain(AVATAR_SELECTOR);
      expect(css).not.toContain("progressbar");
      expect(css).not.toMatch(/[:\s,(]red[;\s,)]/);
      expectBalanced(css);
    }
  });

  it("rejects near misses of #rrggbb", () => {
    for (const bad of [
      "#fff",
      "#ffffffff",
      "ffffff",
      " #ffffff",
      "#ffffff ",
      "#ffffff\n",
      "#ggggggg",
      "rgb(0,0,0)",
      "",
    ]) {
      expect(buildExtrasCss(neutral({ nameStyle: "custom", nameColor: bad }))).toBe("");
    }
    expect(
      buildExtrasCss(neutral({ nameStyle: "custom", nameColor: 0xffffff as unknown as string })),
    ).toBe("");
  });

  it("accepts upper-case hex", () => {
    expect(buildExtrasCss(neutral({ nameStyle: "custom", nameColor: "#AABBCC" }))).toContain(
      "color: #AABBCC !important",
    );
  });
});

describe("buildExtrasCss: animations", () => {
  it("emits shared keyframes once", () => {
    const css = buildExtrasCss(neutral({ nameStyle: "rainbow", levelStyle: "rainbow" }));
    expect(count(css, "@keyframes ft-px-rainbow")).toBe(1);
    expect(count(css, "animation: ft-px-rainbow")).toBe(2);
  });

  it("emits each keyframes at most once with everything animated", () => {
    const css = buildExtrasCss(
      neutral({ nameStyle: "rainbow", frame: "rainbow", levelStyle: "rainbow" }),
    );
    expect(count(css, "@keyframes ft-px-rainbow")).toBe(1);
    expect(count(css, "@keyframes ft-px-hue")).toBe(1);
    expect(count(css, "@keyframes ft-px-stripes")).toBe(0);
    expect(count(css, "@keyframes")).toBe(2);
  });

  it("turns every animation off for reduced motion, as the last rule", () => {
    const css = buildExtrasCss(
      neutral({ nameStyle: "rainbow", frame: "rainbow", levelStyle: "striped" }),
    );
    const lines = css.split("\n");
    const last = lines[lines.length - 1];
    expect(last.startsWith("@media (prefers-reduced-motion: reduce) {")).toBe(true);
    expect(last).toContain(`html ${NAME_SELECTOR}`);
    expect(last).toContain(`html ${AVATAR_SELECTOR}::before`);
    expect(last).toContain(`html ${LEVEL_FILL_SELECTOR}`);
    expect(last).toContain("animation: none !important");
    expect(count(css, "prefers-reduced-motion")).toBe(1);
  });

  it("has no reduced-motion block without animation", () => {
    const css = buildExtrasCss(
      neutral({
        nameStyle: "gradient",
        frame: "gradient",
        levelStyle: "gradient",
        bannerGradient: "aurora",
        bannerDim: 20,
        bannerBlur: 2,
        cardGlow: true,
      }),
    );
    expect(css).not.toBe("");
    expect(css).not.toContain("prefers-reduced-motion");
    expect(css).not.toContain("@keyframes");
  });
});

describe("buildExtrasCss: shape of the output", () => {
  const variants: ProfileExtras[] = [];
  for (const nameStyle of NAME_STYLES) variants.push(neutral({ nameStyle }));
  for (const nameFont of NAME_FONTS) variants.push(neutral({ nameFont }));
  for (const frame of FRAMES) variants.push(neutral({ frame }));
  for (const levelStyle of LEVEL_STYLES) variants.push(neutral({ levelStyle }));
  for (const nameStyle of NAME_STYLES) {
    for (const frame of FRAMES) {
      for (const levelStyle of LEVEL_STYLES) {
        variants.push(
          neutral({
            nameStyle,
            nameFont: "serif",
            frame,
            levelStyle,
            bannerGradient: "space",
            bannerDim: 35,
            bannerBlur: 8,
            cardGlow: true,
          }),
        );
      }
    }
  }

  it("has balanced braces and no stray value for every combination", () => {
    for (const x of variants) {
      const css = buildExtrasCss(x);
      expectBalanced(css);
      expect(css).not.toMatch(/undefined|NaN|\[object|null/);
    }
  });

  it("wins over profile-card.ts: html prefix and !important everywhere", () => {
    for (const x of variants) {
      const css = buildExtrasCss(x);
      if (!css) continue;
      for (const line of css.split("\n")) {
        if (line.startsWith("@keyframes ")) continue;
        const body = line.startsWith("@media ")
          ? line.slice(line.indexOf("{") + 1, line.lastIndexOf("}")).trim()
          : line;
        const open = body.indexOf("{");
        const selectors = body.slice(0, open).split(",");
        for (const s of selectors) expect(s.trim().startsWith("html ")).toBe(true);
        const declarations = body
          .slice(open + 1, body.lastIndexOf("}"))
          .split(";")
          .map((d) => d.trim())
          .filter(Boolean);
        expect(declarations.length).toBeGreaterThan(0);
        for (const d of declarations) expect(d.endsWith("!important")).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    const x = neutral({ nameStyle: "rainbow", frame: "neon", levelStyle: "striped" });
    expect(buildExtrasCss(x)).toBe(buildExtrasCss({ ...x }));
  });
});
