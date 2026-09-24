/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * The Agenda card's event type filter names the known types in the UI
 * language. The names come from data/event_types.json (English `display`),
 * so they used to stay in English after a French "Tout afficher".
 */
import { describe, it, expect, afterEach } from "vitest";
import { setLang } from "../src/core/i18n/i18n.ts";
import { injectEventsSelect } from "../src/features/profile/cards/events/events.ts";

const EVENT_TYPES = {
  event_types: {
    exam: { display: "Exam", keywords: ["exam"] },
    meet_up: { display: "Meet up", keywords: ["meetup"] },
    // a type added to the data file later: shown as the file writes it
    game_jam: { display: "Game jam", keywords: ["jam"] },
  },
};

async function mountAgenda(): Promise<string[]> {
  const agenda = document.createElement("div");
  const link = document.createElement("a");
  link.href = "/events";
  link.textContent = "Agenda";
  agenda.appendChild(link);
  document.body.replaceChildren(agenda);
  await chrome.storage.local.set({
    EVENT_TYPES_DATA: { data: EVENT_TYPES, timestamp: Date.now() },
  });
  await injectEventsSelect();
  const root = document.getElementById("events-shadow-host")!.shadowRoot!;
  return [...root.querySelectorAll("option")].map((o) => o.textContent!.trim());
}

afterEach(async () => {
  setLang("en");
  await chrome.storage.local.clear();
});

describe("Agenda filter", () => {
  it("is in French in the French UI, values unchanged", async () => {
    setLang("fr");
    expect(await mountAgenda()).toEqual(["Tout afficher", "Examen", "Meetup", "Game jam"]);
    const root = document.getElementById("events-shadow-host")!.shadowRoot!;
    expect([...root.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "all",
      "exam",
      "meet_up",
      "game_jam",
    ]);
  });

  it("reads as before in English", async () => {
    expect(await mountAgenda()).toEqual(["Show All", "Exam", "Meet up", "Game jam"]);
  });
});

describe("eventKindLabel", () => {
  it("shows a type whose id is also a name every object inherits as the data writes it", async () => {
    const { eventKindLabel } = await import("../src/core/intra/event-kinds.ts");
    setLang("fr");
    expect(eventKindLabel("constructor", "Builders")).toBe("Builders");
    expect(eventKindLabel("toString")).toBe("toString");
    expect(eventKindLabel("workshop", "Workshop")).toBe("Atelier");
  });
});
