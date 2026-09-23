/**
 * Asks the theme manager to show a visited profile's theme preset (null: the
 * viewer's own again). An event rather than a call: the public look code that
 * sends it is also bundled in the popup, which must not carry the theme
 * manager and its colour table. initThemeManager() is what listens.
 */
export const VISITOR_PRESET_EVENT = "42_VISITOR_PRESET";

export function requestVisitorPreset(key: string | null): void {
  document.dispatchEvent(new CustomEvent<string | null>(VISITOR_PRESET_EVENT, { detail: key }));
}
