import { describe, it, expect, beforeEach } from "vitest";
import {
  CARD_IDS,
  CUSTOMIZE_KEYS,
  buildCustomizeCss,
  sanitizeCardMap,
  type CustomizeConfig,
} from "../src/features/customize/customize";
import { cardIdFromTitle, tagDashboardCards } from "../src/features/customize/cards";
import { sanitizePublicLook } from "../src/features/customize/public-look";
import { decodePresetCode, encodePresetCode } from "../src/features/customize/presets";
import { CONFIG_DEFAULT } from "../src/core/config";

const base = Object.fromEntries(
  CUSTOMIZE_KEYS.map((k) => [k, CONFIG_DEFAULT[k]]),
) as CustomizeConfig;

describe("sanitizeCardMap", () => {
  it("keeps known cards with hex colours and glow only", () => {
    expect(
      sanitizeCardMap({
        agenda: { bg: "#112233", border: "red", title: "#AABBCC", glow: true, extra: 1 },
        projects: { bg: "#000000; } * { display:none" },
        nope: { bg: "#112233" },
        logtime: "x",
      }),
    ).toEqual({ agenda: { bg: "#112233", title: "#AABBCC", glow: true } });
    expect(sanitizeCardMap(null)).toEqual({});
    expect(sanitizeCardMap([])).toEqual({});
  });
});

describe("dashboard card rules", () => {
  it("frames every card with the accent or a custom colour", () => {
    const accent = buildCustomizeCss({ ...base, CUSTOM_CARD_BORDER_MODE: "accent", CUSTOM_CARD_BORDER_WIDTH: 3 });
    expect(accent).toContain('[data-ft-card] { border: 3px solid hsl(var(--primary)) !important; }');
    const custom = buildCustomizeCss({ ...base, CUSTOM_CARD_BORDER_MODE: "custom", CUSTOM_CARD_BORDER_COLOR: "#ff0000", CUSTOM_CARD_GLOW: true });
    expect(custom).toContain("border: 2px solid #ff0000 !important");
    expect(custom).toContain("0 0 22px color-mix(in srgb, #ff0000 45%, transparent)");
    expect(buildCustomizeCss(base)).not.toContain("data-ft-card");
  });

  it("colours titles and per-card overrides, after the generic card rules", () => {
    const css = buildCustomizeCss({
      ...base,
      CUSTOM_CARD_OPACITY: 80,
      CUSTOM_CARD_TITLE_MODE: "accent",
      CUSTOM_CARDS: { projects: { bg: "#101010", title: "#00ff00" }, agenda: { glow: true } },
    });
    expect(css).toContain('[data-ft-card] [class*="uppercase"] { color: hsl(var(--primary)) !important; }');
    expect(css).toContain('[data-ft-card="projects"] { background-color: #101010 !important; }');
    expect(css).toContain('[data-ft-card="projects"] [class*="uppercase"] { color: #00ff00 !important; }');
    expect(css).toContain('[data-ft-card="agenda"] { box-shadow');
    expect(css.indexOf("hsl(var(--card) / 0.80)")).toBeLessThan(css.indexOf('[data-ft-card="projects"]'));
  });
});

describe("tagDashboardCards", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("maps titles to card ids", () => {
    expect(cardIdFromTitle("Pending Evaluations")).toBe("evaluations");
    expect(cardIdFromTitle("  LAST ACHIEVEMENTS ")).toBe("achievements");
    expect(cardIdFromTitle("Something else")).toBeNull();
    expect(CARD_IDS).toContain("roulette");
  });

  it("tags cards by their heading and the logtime host", () => {
    const mk = (title: string) => {
      const card = document.createElement("div");
      card.className = "bg-white md:h-96";
      const h = document.createElement("h2");
      h.className = "text-xs uppercase";
      h.textContent = title;
      card.appendChild(h);
      document.body.appendChild(card);
      return card;
    };
    const agenda = mk("Agenda");
    const projects = mk("Projects");
    const other = mk("Unknown card");
    const host = document.createElement("div");
    host.id = "logtime-shadow-wrapper";
    document.body.appendChild(host);
    tagDashboardCards();
    expect(agenda.dataset.ftCard).toBe("agenda");
    expect(projects.dataset.ftCard).toBe("projects");
    expect(other.dataset.ftCard).toBeUndefined();
    expect(host.dataset.ftCard).toBe("logtime");
  });
});

describe("cards in the public look and theme codes", () => {
  it("are validated in the public look", () => {
    const look = sanitizePublicLook({
      CUSTOM_CARD_BORDER_MODE: "accent",
      CUSTOM_CARD_BORDER_WIDTH: 99,
      CUSTOM_CARD_TITLE_MODE: "bogus",
      CUSTOM_CARDS: { agenda: { bg: "#123456" }, nope: {} },
    });
    expect(look).toEqual({
      CUSTOM_CARD_BORDER_MODE: "accent",
      CUSTOM_CARD_BORDER_WIDTH: 6,
      CUSTOM_CARDS: { agenda: { bg: "#123456" } },
    });
    expect(sanitizePublicLook({ CUSTOM_CARDS: { agenda: { bg: "red" } } })).toBeNull();
  });

  it("round-trip through a theme code", () => {
    const values = { ...base, CUSTOM_CARDS: { roulette: { border: "#ff00ff", glow: true } } };
    expect(decodePresetCode(encodePresetCode(values))?.CUSTOM_CARDS).toEqual(values.CUSTOM_CARDS);
  });
});
