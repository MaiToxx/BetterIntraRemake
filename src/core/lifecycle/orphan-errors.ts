/**
 * After an update (or a reload of the extension), Chrome keeps the old
 * content script running in the tabs that were already open, cut off from
 * the extension: every chrome.* call it still makes rejects with "Extension
 * context invalidated". Nothing is wrong and nothing can be done in that tab
 * until it reloads (the gear offers it), but each of those rejections landed
 * in the extension's error list as "Uncaught (in promise)", burying the real
 * errors. Firefox tears the old script down instead (stale-instance.ts).
 */

/** Whether `reason` (an error or anything thrown) is the cut-off one. */
export function isOrphanError(reason: unknown): boolean {
  const message =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return /extension context invalidated/i.test(message);
}

let installed = false;

/** Keeps those rejections out of the error list; every other one still shows. */
export function installOrphanErrorFilter(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener("unhandledrejection", (event) => {
    if (isOrphanError(event.reason)) event.preventDefault();
  });
}
