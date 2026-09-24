/**
 * The hub in a narrow window and in French, where the text runs longer.
 * jsdom lays nothing out, so these cases pin the classes that keep each
 * control inside its card (measured in Firefox from 390 to 1280 px):
 *  - a radio group spilled past its card's LEFT edge on a phone, where no
 *    scroll reaches ("Show All" of Event visibility could not be clicked),
 *    and the seven event types past its right edge up to about 900 px;
 *  - long divider titles were cut, never wrapped (and wrapping them must
 *    keep the dividers' rules);
 *  - the Extras cards sat in two ~150 px columns with their descriptions
 *    clamped to two lines (what "Share with the community" sends was cut);
 *  - a fixed 11 rem select cut "Par défaut du navigateur", phone and desktop;
 *  - the About tab's rows never wrapped (egg counter, Star, tiles, links);
 *  - the Customize tab's stroked sun icon was drawn as a bare dot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render } from "lit-html";
import { renderSetting } from "../src/features/hub/controls/setting.ts";
import { renderFeatureCards } from "../src/features/hub/controls/feature-cards.ts";
import { renderRadioGroup, renderSelect } from "../src/features/hub/controls/basic.ts";
import type { LiveOptions } from "../src/features/hub/controls/context.ts";
import {
  FEATURE_DEFS,
  HUB_SETTING_DEFS,
  type HubSettingDef,
} from "../src/features/hub/hubSettings.data.ts";

const LIVE: LiveOptions = { campuses: [], eventTypes: [] };
const allDefs = Object.values(HUB_SETTING_DEFS).flat();
const byKey = (key: string) => allDefs.find((d) => d.key === key)!;

function mount(template: unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(template, host);
  return host;
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** The element around a setting's control, inside its card. */
function controlWrapper(def: HubSettingDef): HTMLElement {
  const card = mount(renderSetting(def, true, false, LIVE));
  const label = card.querySelector(`[id$="-label"]`)!;
  // the card's row: [label + description] [control wrapper]
  return label.closest(".card")!.firstElementChild!.lastElementChild as HTMLElement;
}

beforeEach(async () => {
  document.body.replaceChildren();
  await chrome.storage.local.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("controls stay inside their card", () => {
  it("a radio group stacks on a phone, over the card's whole width", async () => {
    const def = byKey("PROFILE_EVENT_TYPE_FILTER");
    const wrapper = controlWrapper(def);
    expect(wrapper.className).toMatch(/\bmax-w-full\b/);
    expect(wrapper.className).toMatch(/\bmin-w-0\b/);
    expect(wrapper.className).toMatch(/\bmax-sm:self-stretch\b/);
    await settle();
    const group = wrapper.querySelector('[role="radiogroup"]')!;
    expect(group.className).toMatch(/\bjoin\b/);
    expect(group.className).toMatch(/\bmax-sm:join-vertical\b/);
  });

  it("a long list (the seven event types) stays stacked until lg, a short one only on a phone", async () => {
    // French at 700 and 820 px: the seven buttons in one line ran 200 and
    // 80 px past the card's right edge; at 1024 px they fit.
    const live: LiveOptions = {
      ...LIVE,
      eventTypes: ["exam", "conference", "workshop", "hackathon", "event", "meet_up"].map(
        (value) => ({ label: value, value }),
      ),
    };
    const group = (def: HubSettingDef, l: LiveOptions) =>
      mount(renderRadioGroup(def, "all", true, l)).querySelector('[role="radiogroup"]')!;
    const events = group(byKey("PROFILE_EVENT_TYPE_FILTER"), live);
    expect(events.querySelectorAll("input")).toHaveLength(7);
    expect(events.className).toMatch(/\bmax-lg:join-vertical\b/);
    expect(events.className).toMatch(/\bmax-sm:w-full\b/);
    const days = group(byKey("LOGTIME_SHOW_DAYS_MODE"), LIVE);
    expect(days.className).toMatch(/\bmax-sm:join-vertical\b/);
    expect(days.className).not.toMatch(/max-lg:/);
  });

  it("any other control is capped at the card's width too", () => {
    const wrapper = controlWrapper(byKey("PROFILE_SHOW_MARKS"));
    expect(wrapper.className).toMatch(/\bmax-w-full\b/);
    expect(wrapper.className).not.toMatch(/self-stretch/);
  });

  it("a long divider title wraps on a phone", () => {
    const def = allDefs.find((d) => d.kind === "divider")!;
    const divider = mount(renderSetting(def, true, false, LIVE)).querySelector(".divider")!;
    expect(divider.className).toMatch(/\bmax-sm:whitespace-normal\b/);
    // the rules shrink through [&::before], never Tailwind's before: (next case)
    expect(divider.className).toContain("max-sm:[&::before]:w-4");
    expect(divider.className).toContain("max-sm:[&::after]:w-4");
  });

  it("no class uses Tailwind's before: / after: variants, which erase the pseudo-element in a shadow root", () => {
    // before:/after: also write content: var(--tw-content), whose default is
    // an @property rule that a shadow root ignores: content falls back to
    // none. Measured on the hub's dividers at 390 px: both rules gone.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (file.endsWith(".ts")) {
          const text = fs.readFileSync(file, "utf8");
          const hits = text.match(/(?:^|[\s"'`])(?:[\w-]+:)*(?:before|after):[\w[]/g);
          if (hits) offenders.push(`${path.relative("src", file)}: ${hits.join(" ").trim()}`);
        }
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });

  it("a select takes the card's width on a phone, grows on a wide screen, never past its card", () => {
    const def = byKey("CUSTOM_SCROLLBAR");
    const select = mount(renderSelect(def, "default", true, LIVE)).querySelector("select")!;
    expect(select.className).toMatch(/\bmax-sm:w-full\b/);
    expect(select.className).toMatch(/\blg:w-60\b/);
    expect(select.className).toMatch(/\bmax-w-full\b/);
    expect(controlWrapper(def).className).toMatch(/\bmax-sm:self-stretch\b/);
  });
});

describe("Extras cards", () => {
  it("one column until md, descriptions never clamped", async () => {
    const def = allDefs.find((d) => d.kind === "feature-cards")!;
    const host = mount(await renderFeatureCards(def, true));
    const grid = host.firstElementChild!;
    expect(grid.className).toMatch(/\bgrid-cols-1\b/);
    expect(grid.className).toMatch(/\bmd:grid-cols-2\b/);
    expect(grid.className.split(/\s+/)).not.toContain("grid-cols-2");
    expect(host.querySelector('[class*="line-clamp"]')).toBeNull();
    expect(host.querySelector("#hub-fc-SUBJECT_TRACKER_SEND_DATA-desc, [id$='SEND_DATA-desc']")).not.toBeNull();
  });
});

describe("About tab", () => {
  it("wraps the hero and the community tiles, and stacks the quick links on a phone", async () => {
    vi.resetModules();
    const stats = {
      total: 312,
      newToday: 3,
      newLast7Days: 25,
      newLast14Days: 41,
      newLast30Days: 88,
      countries: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => stats })));
    const { renderAboutPanel } = await import("../src/features/hub/hub.about.ts");
    const host = mount(renderAboutPanel());
    await settle();
    const h1 = host.querySelector("h1")!;
    expect(h1.parentElement!.className).toMatch(/\bflex-wrap\b/);
    const tiles = [...host.querySelectorAll("span")].find((s) => s.textContent === "+25")!;
    const tileRow = tiles.closest("div")!.parentElement!;
    expect(tileRow.className).toMatch(/\bflex-wrap\b/);
    expect(tileRow.parentElement!.className).toMatch(/\bflex-wrap\b/);
    const links = host.querySelector(".join")!;
    expect(links.className).toMatch(/\bmax-sm:join-vertical\b/);
  });
});

describe("tab icons", () => {
  it("are filled icons: the tab sheet drops strokes (a stroked icon showed as a dot)", () => {
    for (const f of FEATURE_DEFS) {
      expect(f.icon, f.id).not.toMatch(/fill="none"|stroke="currentColor"/);
    }
  });
});

describe("Value of an hour", () => {
  it("no longer asks for an hourly pay", () => {
    const def = byKey("LOGTIME_EMOJI_RATE");
    expect(`${def.label} ${def.desc}`).not.toMatch(/\bearn/i);
    expect(def.desc).toMatch(/not your real pay/);
  });
});
