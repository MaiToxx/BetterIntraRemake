/**
 * Profile > Event visibility: the event types come from the data files in
 * English ("Exam", "Meet up"), and the French hub showed them so after its
 * one French button. The known types now follow the hub's language; a type
 * the data adds later shows as written, and the values (what the saved
 * filter holds) stay the data's ids.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render } from "lit-html";
import { setLang } from "../src/core/i18n/i18n.ts";
import { loadCatalog } from "../scripts/i18n-catalog.ts";
import { renderRadioGroup, renderSelect } from "../src/features/hub/controls/basic.ts";
import { PROFILE_SETTINGS } from "../src/features/hub/settings/profile.ts";
import type { LiveOptions } from "../src/features/hub/controls/context.ts";

const def = PROFILE_SETTINGS.find((d) => d.key === "PROFILE_EVENT_TYPE_FILTER")!;
const LIVE: LiveOptions = {
  campuses: [],
  eventTypes: [
    { label: "Exam", value: "exam" },
    { label: "Meet up", value: "meet_up" },
    { label: "Pool party", value: "pool_party" },
  ],
};
const fr = loadCatalog();

afterEach(() => setLang("en"));

function radios(): HTMLInputElement[] {
  const host = document.createElement("div");
  render(renderRadioGroup(def, "all", true, LIVE), host);
  return [...host.querySelectorAll<HTMLInputElement>("input[type=radio]")];
}

function options(): HTMLOptionElement[] {
  const host = document.createElement("div");
  render(renderSelect(def, "all", true, LIVE), host);
  return [...host.querySelectorAll("option")];
}

describe("Event visibility", () => {
  it("English: the names as the data writes them", () => {
    expect(radios().map((r) => r.getAttribute("aria-label"))).toEqual([
      "Show All",
      "Exam",
      "Meet up",
      "Pool party",
    ]);
  });

  it("French: the known types translated, a new one as written, the values unchanged", () => {
    setLang("fr");
    const expected = [fr["Show All"], fr["Exam"], fr["Meet up"], "Pool party"];
    expect(radios().map((r) => r.getAttribute("aria-label"))).toEqual(expected);
    expect(radios().map((r) => r.value)).toEqual(["all", "exam", "meet_up", "pool_party"]);
    expect(options().map((o) => o.textContent!.trim())).toEqual(expected);
    expect(fr["Exam"]).not.toBe("Exam");
  });
});
