/**
 * The owner's own preview of an image picked in the editor and not uploaded
 * yet (uploads happen on Save, see pending-uploads.ts).
 *
 * The picked file is shown from a data: URL read here. Such a URL is only
 * ever written into the editor and into this page's own preview sheet below:
 * FormState, storage, the URL history and the cloud sync never hold it, and
 * the sanitizers that guard other students' visuals (sanitizeCssUrl,
 * sanitizeVisualUrls) keep refusing it.
 *
 * data: rather than blob:: a blob URL made by a Firefox content script is not
 * guaranteed to load from the page, and Intra sends no CSP that refuses a
 * data: image (docs/FIREFOX-TESTING.md).
 */
import { BACKGROUND_SELECTOR, BANNER_SELECTOR } from "../../../core/intra/selectors.ts";

/**
 * Only base64 characters after the prefix: nothing in it can end a quoted
 * url("...") or the declaration around it.
 */
const DATA_URL_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

/** `value` when it is a local image preview as read below, "" otherwise. */
export function localPreviewUrl(value: unknown): string {
  return typeof value === "string" && DATA_URL_RE.test(value) ? value : "";
}

/** The picked image as a data: URL, or "" when it cannot be read. */
export function readLocalPreview(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(localPreviewUrl(reader.result));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    } catch {
      resolve("");
    }
  });
}

const STYLE_ID = "ft-local-preview-style";

/**
 * The fill modes of visuals-apply.ts, which does not export its table. A
 * picked banner has to look the way it will once saved.
 */
const MODE_CSS: Record<string, string> = {
  fill: "background-size: cover !important; background-repeat: no-repeat !important; background-position: center !important;",
  fit: "background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important;",
  stretch:
    "background-size: 100% 100% !important; background-repeat: no-repeat !important; background-position: center !important;",
  center:
    "background-size: auto !important; background-repeat: no-repeat !important; background-position: center !important;",
  tile: "background-size: auto !important; background-repeat: repeat !important; background-position: top left !important;",
};

export interface LocalPagePreview {
  banner?: string;
  bannerMode?: string;
  background?: string;
  backgroundMode?: string;
}

/**
 * Paints picked banner/background files over the page's own ones while the
 * editor is open; with nothing picked the sheet goes away. `:root` in front
 * outranks the rules applyImgs() writes (same selectors, also !important),
 * whichever sheet comes first. The text is compared before it is written: the
 * editor repaints on every edit (each step of an avatar drag), and a data:
 * URL can be megabytes of CSS to parse again.
 */
export function paintLocalPreview(preview: LocalPagePreview): void {
  const rules: string[] = [];
  const banner = localPreviewUrl(preview.banner);
  const background = localPreviewUrl(preview.background);
  if (banner) {
    rules.push(
      `:root ${BANNER_SELECTOR} { background-image: url("${banner}") !important; ${MODE_CSS[preview.bannerMode ?? ""] ?? MODE_CSS.fill} }`,
    );
  }
  if (background) {
    rules.push(
      `:root ${BACKGROUND_SELECTOR} { background-image: url("${background}") !important; ${MODE_CSS[preview.backgroundMode ?? ""] ?? MODE_CSS.fill} }`,
    );
  }
  const existing = document.getElementById(STYLE_ID);
  if (rules.length === 0) {
    existing?.remove();
    return;
  }
  const text = rules.join("\n");
  const style = existing ?? document.createElement("style");
  if (!existing) {
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== text) style.textContent = text;
}

export function clearLocalPreview(): void {
  document.getElementById(STYLE_ID)?.remove();
}
