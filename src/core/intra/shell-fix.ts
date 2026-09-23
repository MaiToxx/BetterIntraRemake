/**
 * A workaround for the Intra v3 shell itself, on every page it draws.
 *
 * Below the md breakpoint (768 px) the shell keeps its sidebar column
 * (INTRA_SIDEBAR_COLUMN_SELECTOR) fixed over the left 80 px of the page, full
 * height and transparent, while the content only makes room for it from md
 * up (`md:pl-20`). The column still takes pointer events, so every click or
 * tap in those 80 px hit nothing: links at the start of each card, the
 * logtime Monday column and the carousel's Previous arrow, the left end of
 * the badge row. Its children keep taking them: the 42 tile, and the menu,
 * which sits off-screen (`left-[-100%]`) until the burger opens it.
 *
 * Tied to the shell's utility classes: once a deploy renames them the rule
 * matches nothing and the page behaves as it does without the extension.
 */
import { INTRA_SIDEBAR_COLUMN_SELECTOR } from "./selectors.ts";

export const INTRA_SHELL_FIX_ID = "ft-intra-shell-fix";

export const INTRA_SHELL_FIX_CSS =
  `@media (max-width: 767px) { ` +
  `${INTRA_SIDEBAR_COLUMN_SELECTOR} { pointer-events: none; } ` +
  `${INTRA_SIDEBAR_COLUMN_SELECTOR} > * { pointer-events: auto; } }`;

/**
 * Install the rule once. Called at document_start, before the shell renders,
 * so <head> may not exist yet: the sheet goes on <html> then, as the avatar
 * hold does. The "ft-" id is what the stale-instance cleanup removes after an
 * add-on update, before the new instance installs its own.
 */
export function injectIntraShellFix(doc: Document = document): void {
  if (doc.getElementById(INTRA_SHELL_FIX_ID)) return;
  const host = doc.head || doc.documentElement;
  if (!host) return;
  const style = doc.createElement("style");
  style.id = INTRA_SHELL_FIX_ID;
  style.textContent = INTRA_SHELL_FIX_CSS;
  host.appendChild(style);
}
