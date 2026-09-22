/**
 * Tag the dashboard/profile cards with `data-ft-card="<id>"` so that the
 * Customize stylesheet can address each one (background, border, title).
 * Cheap and idempotent: called on every pass of the profile page.
 */
import { CARD_TITLES } from "./customize.ts";
import {
  CARD_TITLE_SELECTOR,
  DASHBOARD_CARD_SELECTOR,
} from "../../core/intra/selectors.ts";

const CARD_SELECTOR = `${DASHBOARD_CARD_SELECTOR}:not([data-ft-card]), .lt-box-container:not([data-ft-card])`;

export function cardIdFromTitle(title: string): string | null {
  const t = title.trim().toUpperCase();
  if (!t) return null;
  if (CARD_TITLES[t]) return CARD_TITLES[t];
  for (const [known, id] of Object.entries(CARD_TITLES)) {
    if (t.includes(known)) return id;
  }
  return null;
}

export function tagDashboardCards(root: ParentNode = document): void {
  const host = (root instanceof Document ? root : document).getElementById(
    "logtime-shadow-wrapper",
  );
  if (host && !host.dataset.ftCard) host.dataset.ftCard = "logtime";

  root.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((card) => {
    const heading = card.querySelector<HTMLElement>(CARD_TITLE_SELECTOR);
    const id =
      cardIdFromTitle(heading?.textContent ?? "") ??
      cardIdFromTitle((card.textContent ?? "").slice(0, 200));
    if (id) card.dataset.ftCard = id;
  });
}
