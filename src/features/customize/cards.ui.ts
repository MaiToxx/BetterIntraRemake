/**
 * "Per-card colours" panel of the Customize tab: one row per dashboard card
 * (Agenda, Pending evaluations, Last achievements, Projects, Thursday
 * roulette, Logtime) with an optional background, border and title colour
 * and a glow toggle. Stored in CUSTOM_CARDS, shared with the public look.
 */
import { html, render } from "lit-html";
import { ref } from "lit-html/directives/ref.js";
import {
  CARD_IDS,
  CARD_LABELS,
  sanitizeCardMap,
  type CardId,
  type CardLook,
  type CardLookMap,
} from "./customize.ts";
import { publishLookIfShared } from "./publish.ts";
import { msg, t } from "../../core/i18n/i18n.ts";

const KEY = "CUSTOM_CARDS";
/**
 * The texts are English keys (msg), translated with t() when drawn: one whole
 * sentence per field, so each language can agree the colour with its noun.
 */
const FIELDS: {
  field: "bg" | "border" | "title";
  label: string;
  tip: string;
  custom: string;
  colour: string;
  fallback: string;
}[] = [
  {
    field: "bg",
    label: msg("Background"),
    tip: msg("Use a custom background colour"),
    custom: msg("Custom background colour for {card}"),
    colour: msg("Background colour for {card}"),
    fallback: "#151a24",
  },
  {
    field: "border",
    label: msg("Border"),
    tip: msg("Use a custom border colour"),
    custom: msg("Custom border colour for {card}"),
    colour: msg("Border colour for {card}"),
    fallback: "#00babc",
  },
  {
    field: "title",
    label: msg("Title"),
    tip: msg("Use a custom title colour"),
    custom: msg("Custom title colour for {card}"),
    colour: msg("Title colour for {card}"),
    fallback: "#00babc",
  },
];

async function load(): Promise<CardLookMap> {
  const store = await chrome.storage.local.get(KEY);
  return sanitizeCardMap(store[KEY]);
}

async function save(map: CardLookMap): Promise<void> {
  await chrome.storage.local.set({ [KEY]: sanitizeCardMap(map) });
  publishLookIfShared(KEY);
}

export function renderCardsPanel() {
  const setup = (el: Element | undefined) => {
    if (!el) return;
    const container = el as HTMLElement;
    if (container.dataset.cardsReady) return;
    container.dataset.cardsReady = "1";

    let map: CardLookMap = {};

    const update = (id: CardId, patch: (look: CardLook) => void) => {
      const look = { ...(map[id] ?? {}) };
      patch(look);
      for (const k of Object.keys(look) as (keyof CardLook)[]) {
        if (look[k] === undefined || look[k] === "" || look[k] === false) delete look[k];
      }
      if (Object.keys(look).length) map = { ...map, [id]: look };
      else {
        const next = { ...map };
        delete next[id];
        map = next;
      }
      draw();
      void save(map);
    };

    const row = (id: CardId) => {
      const look = map[id] ?? {};
      const card = t(CARD_LABELS[id]);
      return html`<div class="flex flex-wrap items-center gap-3 py-2 border-b border-base-300 last:border-b-0">
        <span class="w-40 font-medium">${card}</span>
        ${FIELDS.map(({ field, label, tip, custom, colour, fallback }) => {
          const value = look[field];
          return html`<label class="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              class="checkbox checkbox-xs checkbox-accent"
              title="${t(tip)}"
              aria-label="${t(custom, { card })}"
              .checked="${!!value}"
              @change="${(e: Event) => {
                const on = (e.target as HTMLInputElement).checked;
                update(id, (l) => {
                  l[field] = on ? (l[field] ?? fallback) : undefined;
                });
              }}"
            />
            ${t(label)}
            <input
              type="color"
              class="input input-accent p-0.5 w-9 h-7"
              aria-label="${t(colour, { card })}"
              .value="${value ?? fallback}"
              ?disabled="${!value}"
              @change="${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                update(id, (l) => {
                  l[field] = v;
                });
              }}"
            />
          </label>`;
        })}
        <label class="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            class="toggle toggle-xs toggle-accent"
            aria-label="${t("Glow on {card}", { card })}"
            .checked="${!!look.glow}"
            @change="${(e: Event) => {
              const on = (e.target as HTMLInputElement).checked;
              update(id, (l) => {
                l.glow = on;
              });
            }}"
          />
          ${t("Glow")}
        </label>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          title="${t("Back to the default look for this card")}"
          aria-label="${t("Clear the {card} look", { card })}"
          ?disabled="${!map[id]}"
          @click="${() => update(id, (l) => {
            delete l.bg;
            delete l.border;
            delete l.title;
            delete l.glow;
          })}"
        >
          ${t("Clear")}
        </button>
      </div>`;
    };

    const draw = () =>
      render(
        html`<div class="flex flex-col">
          ${CARD_IDS.map(row)}
          <p class="text-xs opacity-60 pt-2">
            ${t(
              "Tick a colour to override it for that card only. The border width comes from the setting above; Logtime only takes a border and glow (its content has its own colours in the Logtime tab).",
            )}
          </p>
        </div>`,
        container,
      );

    void load().then((m) => {
      map = m;
      draw();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(KEY in changes) || !container.isConnected) return;
      const next = sanitizeCardMap(changes[KEY].newValue);
      if (JSON.stringify(next) !== JSON.stringify(map)) {
        map = next;
        draw();
      }
    });
    draw();
  };

  return html`<div ${ref(setup)} class="col-span-full"></div>`;
}
