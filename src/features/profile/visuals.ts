import { getConfig, getConfigMany } from "../../config.ts";
import { getCloudLogin, fetchUserVisuals } from "../account/account.ts";
import { createSettingsModal } from "./profile.modal.ts";
import { applyThemeToProfileCard } from "./profile-card.ts";
import { applyPublicLogtimeSettings, initLogtime } from "../logtime/logtime.ts";
import { sanitizeVisualUrls } from "./visuals-sanitize.ts";
import { applyVisitorLook } from "../customize/customize.ts";
import type { PublicLook } from "../customize/public-look.ts";
import {
  applyOwnProfileExtras,
  applyProfileExtras,
  clearProfileExtras,
  extrasAreVisible,
} from "./extras/extras-apply.ts";
import { html, render } from "lit-html";
import { waitForElement } from "../../utils/dom-wait.ts";

/** Logins known to have no cloud visuals, with the time we learned it. */
const noVisualsCache = new Map<string, number>();
const NO_VISUALS_TTL_MS = 10 * 60 * 1000;
/** Budget for the avatar to be rendered by React (~30 frames, as before). */
const AVATAR_WAIT_MS = 500;
import {
  AVATAR_SELECTOR,
  BANNER_SELECTOR,
  BACKGROUND_SELECTOR,
  TITLE_BADGE_SELECTOR,
} from "./selectors.ts";

export interface VisualUrls {
  avatar: string;
  banner: string;
  bannerMode: string;
  bannerColor?: string;
  background: string;
  backgroundMode: string;
  backgroundColor?: string;
  avatarBg?: string;
  decoration?: string;
  avatarPosX?: number;
  avatarPosY?: number;
  avatarScale?: number;
  badgeBg?: string;
  theme?: { profileColor?: string } | null;
  logtime?: {
    calendarColor?: string;
    labelsColor?: string;
    emoji?: string;
    emojiDivisor?: string | number;
    emojiRate?: string | number;
    rainbowPalette?: string;
  } | null;
  /** Look (accent, palette, background, cards) published by this user. */
  look?: PublicLook | null;
  /** Raw PROFILE_PUB_* settings published by this user (validated when applied). */
  extras?: Record<string, unknown> | null;
}

let isFetching = false;

let historyListenerInstalled = false;

function addToHistory(url: string, history: string[]): string[] {
  if (!url) return history;
  const filtered = history.filter((h) => h !== url);
  return [url, ...filtered].slice(0, 10);
}

/**
 * The signed-in login, read once per page instead of once per mutation pass.
 *
 * WHY: updateVisuals() runs on every burst of DOM mutations and used to await
 * a chrome.storage round-trip for a value that only changes on login/logout -
 * which reloads every Intra tab anyway (background.ts). The storage listener
 * installed below drops the cache, so it stays exact even without that reload.
 */
let cachedOwnLogin: string | null | undefined;
let ownLoginPending: Promise<string | null> | null = null;

const readOwnLogin = async (): Promise<string | null> => {
  if (cachedOwnLogin !== undefined) return cachedOwnLogin;
  if (!ownLoginPending) {
    ownLoginPending = getCloudLogin()
      .then((login) => {
        cachedOwnLogin = login;
        ownLoginPending = null;
        return login;
      })
      .catch((err) => {
        ownLoginPending = null;
        throw err;
      });
  }
  return ownLoginPending;
};

function installHistoryListener(): void {
  if (historyListenerInstalled) return;
  historyListenerInstalled = true;

  const URL_KEYS = [
    "PROFILE_IMAGE_URL",
    "PROFILE_BANNER_URL",
    "PROFILE_BACKGROUND_URL",
  ] as const;
  const HISTORY_KEYS = {
    PROFILE_IMAGE_URL: "PROFILE_IMAGE_HISTORY",
    PROFILE_BANNER_URL: "PROFILE_BANNER_HISTORY",
    PROFILE_BACKGROUND_URL: "PROFILE_BACKGROUND_HISTORY",
  } as const;

  // Missing in a page that only got a partial chrome API shim: the cache above
  // then simply lives for the page, as it did before it existed.
  if (!chrome.storage.onChanged?.addListener) return;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("CLOUD_LOGIN" in changes) {
      cachedOwnLogin = undefined;
      ownLoginPending = null;
    }
    for (const key of URL_KEYS) {
      if (!(key in changes)) continue;
      const newUrl = changes[key].newValue as string | undefined;
      if (!newUrl) continue;
      const historyKey = HISTORY_KEYS[key];
      chrome.storage.local.get(historyKey).then(async (result) => {
        const history = (result[historyKey] as string[]) || [];
        const updated = addToHistory(newUrl, history);
        if (updated !== history) {
          await chrome.storage.local.set({ [historyKey]: updated });
        }
      });
    }
  });
}
let visualCache: VisualUrls | null = null;
let lastUser: string | null = null;
let showingOriginalAvatar = false;
let originalAvatarUrl: string | null = null;

let lastAppliedUser: string | null = null;
let lastAppliedKey: string | null = null;

/**
 * Memo for getVisualKey(): the same object is keyed several times per pass
 * (compare, then store) and the JSON it produces can be a couple of kilobytes
 * once a published look and its extras are in it. VisualUrls objects are
 * replaced, never mutated in place, so identity is a safe cache key.
 */
const visualKeyCache = new WeakMap<VisualUrls, string>();

const getVisualKey = (urls: VisualUrls): string => {
  const cached = visualKeyCache.get(urls);
  if (cached !== undefined) return cached;
  const key = computeVisualKey(urls);
  visualKeyCache.set(urls, key);
  return key;
};

const computeVisualKey = (urls: VisualUrls) =>
  JSON.stringify({
    avatar: urls.avatar || "",
    banner: urls.banner || "",
    bannerMode: urls.bannerMode || "",
    bannerColor: urls.bannerColor || "",
    background: urls.background || "",
    backgroundMode: urls.backgroundMode || "",
    backgroundColor: urls.backgroundColor || "",
    avatarBg: urls.avatarBg || "transparent",
    decoration: urls.decoration || "none",
    avatarPosX: urls.avatarPosX ?? 50,
    avatarPosY: urls.avatarPosY ?? 50,
    avatarScale: urls.avatarScale ?? 100,
    badgeBg: urls.badgeBg || "",
    theme: urls.theme || null,
    logtime: urls.logtime || null,
    look: urls.look || null,
    extras: urls.extras || null,
  });

const CACHE_PREFIX = "visuals_cache_";
const pendingRevalidations = new Set<string>();

const getCachedVisuals = async (login: string): Promise<VisualUrls | null> => {
  const result = (await chrome.storage.local.get(
    `${CACHE_PREFIX}${login}`,
  )) as Record<string, VisualUrls>;
  return result[`${CACHE_PREFIX}${login}`] || null;
};

const setCachedVisuals = (login: string, urls: VisualUrls) => {
  chrome.storage.local.set({ [`${CACHE_PREFIX}${login}`]: urls });
};

const revalidateVisuals = async (login: string, cached: VisualUrls) => {
  if (pendingRevalidations.has(login)) return;
  pendingRevalidations.add(login);
  try {
    const fresh = await fetchUserVisuals(login);
    if (!fresh || login !== lastUser) return;
    const freshKey = getVisualKey(fresh);
    const cachedKey = getVisualKey(cached);
    if (freshKey === cachedKey) {
      // Identical to what is stored (the key covers every field of
      // VisualUrls): re-writing it would only wake every storage.onChanged
      // listener, including the background service worker.
      return;
    }
    visualCache = fresh;
    setCachedVisuals(login, fresh);
    if (
      lastAppliedUser === login &&
      lastAppliedKey === freshKey &&
      !needsReapply(fresh)
    )
      return;
    applyImgs(fresh);
    lastAppliedUser = login;
    lastAppliedKey = freshKey;
  } finally {
    pendingRevalidations.delete(login);
  }
};

const URL_RE = /url\((["']?)(.*?)\1\)/;

/**
 * Is `url` the background image currently showing on `el`?
 *
 * The inline style is read first and getComputedStyle() is only reached when
 * it does not answer: getComputedStyle forces a style recalculation, and this
 * runs on every mutation pass of the profile page.
 */
const hasBackground = (el: HTMLElement | null, url?: string) => {
  if (!url) return true;
  if (!el) return false;
  const inline = el.style.backgroundImage || "";
  if (inline.match(URL_RE)?.[2] === url) return true;
  const computed = window.getComputedStyle(el).backgroundImage || "";
  return computed.match(URL_RE)?.[2] === url;
};

/** The exact rule applyImgs() writes for a banner image (shared so both stay in sync). */
const bannerImageCss = (urls: VisualUrls): string =>
  `background-image: url("${urls.banner}") !important; ${
    modeCss[urls.bannerMode || "fill"] || modeCss.fill
  }`;

/** The exact rule applyImgs() writes for a background image. */
const backgroundImageCss = (urls: VisualUrls): string =>
  `background-image: url("${urls.background}") !important; ${
    modeCss[urls.backgroundMode || "fill"] || modeCss.fill
  }`;

/**
 * True when our <style> element already holds exactly the rule we would write.
 *
 * Banners and backgrounds are applied through a stylesheet, not inline, so
 * comparing the rule text answers "is it applied?" with a plain DOM read
 * instead of a forced style recalculation. When the text matches, re-running
 * applyImgs() would write the very same rule, so there is nothing to redo.
 */
const styleRuleIs = (id: string, selector: string, cssText: string): boolean =>
  document.getElementById(id)?.textContent === `${selector} { ${cssText} }`;

export const badgeColorCss = (badgeBg?: string): string => {
  if (!badgeBg) return "";
  return `background-color: ${badgeBg} !important; border-color: ${badgeBg} !important;`;
};

const needsReapply = (urls: VisualUrls) => {
  const avatar = document.querySelector(AVATAR_SELECTOR) as HTMLElement | null;
  const banner = document.querySelector(BANNER_SELECTOR) as HTMLElement | null;
  const background = document.querySelector(
    BACKGROUND_SELECTOR,
  ) as HTMLElement | null;

  // injectCustomStyles() keeps the avatar at opacity 0 until we have applied
  // the visuals, and applyImgs() is what reveals it. React handing us a freshly
  // rendered element (no inline opacity) therefore always needs a re-apply -
  // this check is what makes the cheaper checks below safe to trust.
  if (avatar && !showingOriginalAvatar && avatar.style.opacity !== "1")
    return true;
  if (
    urls?.avatar &&
    !showingOriginalAvatar &&
    !hasBackground(avatar, urls.avatar)
  )
    return true;
  if (urls.avatar && avatar) {
    const pos = avatar.style.getPropertyValue("background-position");
    const size = avatar.style.getPropertyValue("background-size");
    const expectedPos = `${urls.avatarPosX ?? 50}% ${urls.avatarPosY ?? 50}%`;
    const expectedSize = `${urls.avatarScale ?? 100}%`;
    if (pos !== expectedPos || size !== expectedSize) return true;
  }
  if (
    urls?.banner &&
    !styleRuleIs("ft-banner-style", BANNER_SELECTOR, bannerImageCss(urls)) &&
    !hasBackground(banner, urls.banner)
  )
    return true;
  if (urls?.bannerColor && banner) {
    const style = document.getElementById("ft-banner-style");
    const expectedColor = `background-color: ${urls.bannerColor} !important; background-image: none !important;`;
    if (
      !style ||
      style.textContent !== `${BANNER_SELECTOR} { ${expectedColor} }`
    )
      return true;
  }
  if (
    urls?.background &&
    !styleRuleIs(
      "ft-bg-style",
      BACKGROUND_SELECTOR,
      backgroundImageCss(urls),
    ) &&
    !hasBackground(background, urls.background)
  )
    return true;
  if (urls?.backgroundColor && background) {
    const style = document.getElementById("ft-bg-style");
    const expectedColor = `background-color: ${urls.backgroundColor} !important; background-image: none !important;`;
    if (
      !style ||
      style.textContent !== `${BACKGROUND_SELECTOR} { ${expectedColor} }`
    )
      return true;
  }
  // applyImgs() always writes this rule, empty braces included, so that is
  // what we have to compare against. Expecting an empty <style> when no badge
  // colour is set (the default!) made needsReapply() return true on every
  // single pass, and applyImgs re-ran for nothing on every mutation burst.
  if (
    !styleRuleIs(
      "ft-badge-color-style",
      TITLE_BADGE_SELECTOR,
      badgeColorCss(urls.badgeBg),
    )
  )
    return true;
  return false;
};

export const injectCustomStyles = () => {
  if (document.getElementById("ft-profile-host-styles")) return;
  const style = document.createElement("style");
  style.id = "ft-profile-host-styles";
  style.textContent = `
    .bg-ft-gray b,
      .bg-ft-gray span {font-size: 1.2rem !important;font-weight: bold !important;font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;}
      p.text-sm:nth-child(2) {font-size: 1.3rem !important;}
    #profile-modal-host { 
      position: fixed; inset: 0; z-index: 999999; 
      display: flex; align-items: flex-start; justify-content: center;
      pointer-events: auto; padding-top: 12vh;       
    }
    ${AVATAR_SELECTOR} {
      will-change: background-image, transform;
      transform: translate3d(0, 0, 0);
      backface-visibility: hidden;
      opacity: 0 !important;
    }
    ${AVATAR_SELECTOR}[data-modal-listener] {
      position: relative !important;
    }
    ${AVATAR_SELECTOR}[data-modal-listener]::after {
      content: "Edit";
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(0,0,0,0.45);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }
    ${AVATAR_SELECTOR}[data-modal-listener]:hover::after {
      opacity: 1;
    }
    ${BANNER_SELECTOR},
    ${BACKGROUND_SELECTOR} {
      will-change: background-image, transform;
      transform: translate3d(0, 0, 0);
      backface-visibility: hidden;
    }
    @media (min-width: 1280px) {
      ${BACKGROUND_SELECTOR} {
        height: auto !important;
        min-height: 18rem !important;
      }
    }
    .bg-mode-fill { background-size: cover !important; background-repeat: no-repeat !important; background-position: center !important; }
    .bg-mode-fit { background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important; }
    .bg-mode-stretch { background-size: 100% 100% !important; background-repeat: no-repeat !important; background-position: center !important; }
    .bg-mode-center { background-size: auto !important; background-repeat: no-repeat !important; background-position: center !important; }
    .bg-mode-tile { background-size: auto !important; background-repeat: repeat !important; background-position: top left !important; }

    .banner-mode-fill { background-size: cover !important; background-repeat: no-repeat !important; background-position: center !important; }
    .banner-mode-fit { background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important; }
    .banner-mode-stretch { background-size: 100% 100% !important; background-repeat: no-repeat !important; background-position: center !important; }
    .banner-mode-center { background-size: auto !important; background-repeat: no-repeat !important; background-position: center !important; }
    .banner-mode-tile { background-size: auto !important; background-repeat: repeat !important; background-position: top left !important; }

    .ft-deco-solid {
      box-shadow: 0 0 0 3px var(--user-color, #00babc) !important;
    }

    html.dark .inline-flex.items-center.rounded.border.shadow-base {
      color: #fff !important;
    }

    html:not(.dark) .inline-flex.items-center.rounded.border.shadow-base {
      color: #fff !important;
    }
  `;
  document.head.appendChild(style);
};

const setStyleForSelector = (id: string, selector: string, cssText: string) => {
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = selector ? `${selector} { ${cssText} }` : "";
};

const modeCss: Record<string, string> = {
  fill: "background-size: cover !important; background-repeat: no-repeat !important; background-position: center !important;",
  fit: "background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important;",
  stretch:
    "background-size: 100% 100% !important; background-repeat: no-repeat !important; background-position: center !important;",
  center:
    "background-size: auto !important; background-repeat: no-repeat !important; background-position: center !important;",
  tile: "background-size: auto !important; background-repeat: repeat !important; background-position: top left !important;",
};

const LOOK_BADGE_ID = "ft-visitor-look-badge";
let lookBadgeLogin: string | null = null;
/** Login of the signed-in user (null until known), to tell my page from someone else's. */
let ownLogin: string | null = null;

/**
 * Apply the look published by the profile's owner (or clear it) and show a
 * small badge saying whose look is displayed, with a way to hide it for
 * this visit. Skipped when the viewer hid it for this login in this tab.
 */
function showVisitorLook(
  look: PublicLook | null,
  extras: Record<string, unknown> | null = null,
  hasBackgroundImage = false,
): void {
  const login = lastUser && lastUser !== "me" ? lastUser : null;
  const hiddenKey = login ? `ft-look-hidden-${login}` : "";
  const hidden = hiddenKey ? sessionStorage.getItem(hiddenKey) === "1" : false;
  // My own page never shows a "visitor" look; its extras are rendered from
  // local settings by applyOwnProfileExtras() (see updateVisuals).
  const own = !login || login === ownLogin;
  // Everyone who syncs publishes the default colours, so a non-null
  // `extras` means nothing by itself: ask the sanitizer.
  const visibleExtras = !!extras && extrasAreVisible(extras);
  const active = !own && !hidden && (!!look || visibleExtras);
  void applyVisitorLook(active && look ? look : null);
  if (!own) {
    if (active && visibleExtras) {
      void applyProfileExtras(extras, { login: login!, own: false, hasBackgroundImage });
    } else {
      clearProfileExtras();
    }
  }

  const existing = document.getElementById(LOOK_BADGE_ID);
  if (!active) {
    existing?.remove();
    lookBadgeLogin = null;
    return;
  }
  if (existing && lookBadgeLogin === login) return;
  lookBadgeLogin = login;
  const host = existing ?? document.createElement("div");
  host.id = LOOK_BADGE_ID;
  const hide = () => {
    sessionStorage.setItem(hiddenKey, "1");
    showVisitorLook(null);
  };
  render(
    html`<style>
        #${LOOK_BADGE_ID} {
          position: fixed; right: 16px; bottom: 16px; z-index: 99990;
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px 6px 12px; border-radius: 999px;
          font: 500 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
          background: hsl(var(--card, 220 20% 10%)); color: hsl(var(--card-foreground, 0 0% 95%));
          border: 1px solid hsl(var(--border, 220 20% 18%));
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
        }
        #${LOOK_BADGE_ID} button {
          all: unset; cursor: pointer; opacity: 0.6; padding: 2px 6px; border-radius: 999px; line-height: 1;
        }
        #${LOOK_BADGE_ID} button:hover { opacity: 1; background: hsl(var(--muted, 220 20% 15%)); }
      </style>
      <span title="This profile is shown with the look and extras its owner published with Better Intra">🎨 ${login}'s style</span>
      <button type="button" title="Show my own style instead (this visit only)" @click=${hide}>✕</button>`,
    host,
  );
  if (!existing) (document.body || document.documentElement).appendChild(host);
}

export const applyImgs = (rawUrls: VisualUrls | null) => {
  if (!rawUrls) return;
  // Values may come from another user's cloud settings and end up in <style>
  // text and class names: never trust them as-is.
  const urls = sanitizeVisualUrls(rawUrls);

  const avatar = document.querySelector(AVATAR_SELECTOR) as HTMLElement | null;

  if (avatar && !originalAvatarUrl) {
    const inlineStyle = avatar.style.backgroundImage;
    if (
      inlineStyle &&
      inlineStyle !== "none" &&
      !inlineStyle.includes(urls.avatar)
    ) {
      const match = inlineStyle.match(/url\((['"]?)(.*?)\1\)/);
      if (match) originalAvatarUrl = match[2];
    }
    // Once our own url is the inline background, the computed value can only
    // be that same url: probing it would force a style recalculation to learn
    // nothing. (The inline style always wins over the cascade.)
    if (!originalAvatarUrl && !inlineStyle.includes(urls.avatar)) {
      const computedBg = window.getComputedStyle(avatar).backgroundImage;
      if (
        computedBg &&
        computedBg !== "none" &&
        !computedBg.includes(urls.avatar)
      ) {
        const match = computedBg.match(/url\((['"]?)(.*?)\1\)/);
        if (match) originalAvatarUrl = match[2];
      }
    }
  }

  if (avatar && urls.avatar && !showingOriginalAvatar) {
    avatar.style.setProperty(
      "background-image",
      `url("${urls.avatar}")`,
      "important",
    );
    avatar.style.setProperty(
      "background-color",
      urls.avatarBg || "transparent",
      "important",
    );
    avatar.style.setProperty(
      "background-size",
      `${urls.avatarScale ?? 100}%`,
      "important",
    );
    avatar.style.setProperty(
      "background-position",
      `${urls.avatarPosX ?? 50}% ${urls.avatarPosY ?? 50}%`,
      "important",
    );
  }
  if (avatar && !showingOriginalAvatar) {
    avatar.style.setProperty("opacity", "1", "important");
  }

  if (avatar) {
    avatar.classList.remove("ft-deco-solid");
    const deco = urls.decoration;
    if (deco && deco !== "none") avatar.classList.add(`ft-deco-${deco}`);
  }

  if (urls.banner) {
    setStyleForSelector("ft-banner-style", BANNER_SELECTOR, bannerImageCss(urls));
  } else if (urls.bannerColor) {
    setStyleForSelector(
      "ft-banner-style",
      BANNER_SELECTOR,
      `background-color: ${urls.bannerColor} !important; background-image: none !important;`,
    );
  } else {
    setStyleForSelector("ft-banner-style", BANNER_SELECTOR, "");
  }

  if (urls.background) {
    setStyleForSelector(
      "ft-bg-style",
      BACKGROUND_SELECTOR,
      backgroundImageCss(urls),
    );
  } else if (urls.backgroundColor) {
    setStyleForSelector(
      "ft-bg-style",
      BACKGROUND_SELECTOR,
      `background-color: ${urls.backgroundColor} !important; background-image: none !important;`,
    );
  } else {
    setStyleForSelector("ft-bg-style", BACKGROUND_SELECTOR, "");
  }

  if (urls.theme) {
    applyThemeToProfileCard(urls.theme);
  }

  showVisitorLook(urls.look ?? null, urls.extras ?? null, !!urls.background);

  setStyleForSelector(
    "ft-badge-color-style",
    TITLE_BADGE_SELECTOR,
    badgeColorCss(urls.badgeBg),
  );

  if (urls.logtime) {
    const logtime = urls.logtime;
    // Respect the user's feature toggle: viewing a profile that publishes
    // logtime settings must not render the widget for someone who disabled it.
    getConfig("ACTIVE_SCRIPTS").then((scripts) => {
      if (!Array.isArray(scripts) || !scripts.includes("logtime")) return;
      return initLogtime().then(() => applyPublicLogtimeSettings(logtime));
    });
  }
};

const attachToggleListener = (avatarEl: HTMLElement) => {
  if (avatarEl.dataset.toggleListener) return;
  avatarEl.dataset.toggleListener = "true";
  avatarEl.style.cursor = "pointer";
  avatarEl.title = "Click to view original avatar";
  avatarEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const currentAvatar = document.querySelector(
      AVATAR_SELECTOR,
    ) as HTMLElement;
    if (!currentAvatar) return;
    if (showingOriginalAvatar) {
      showingOriginalAvatar = false;
      if (visualCache?.avatar) {
        currentAvatar.style.setProperty(
          "background-image",
          `url("${visualCache.avatar}")`,
          "important",
        );
        currentAvatar.style.setProperty(
          "background-color",
          visualCache.avatarBg || "transparent",
          "important",
        );
        currentAvatar.style.setProperty(
          "background-size",
          `${visualCache.avatarScale ?? 100}%`,
          "important",
        );
        currentAvatar.style.setProperty(
          "background-position",
          `${visualCache.avatarPosX ?? 50}% ${visualCache.avatarPosY ?? 50}%`,
          "important",
        );
        currentAvatar.classList.remove("ft-deco-solid");
        const d = visualCache.decoration;
        if (d && d !== "none") currentAvatar.classList.add(`ft-deco-${d}`);
      }
    } else {
      showingOriginalAvatar = true;
      currentAvatar.classList.remove("ft-deco-solid");
      if (originalAvatarUrl) {
        currentAvatar.style.setProperty(
          "background-image",
          `url("${originalAvatarUrl}")`,
          "important",
        );
      }
      currentAvatar.style.setProperty("background-size", "cover", "important");
      currentAvatar.style.setProperty(
        "background-position",
        "center",
        "important",
      );
      currentAvatar.style.setProperty(
        "background-color",
        "transparent",
        "important",
      );
    }
  });
};

export const updateVisuals = async () => {
  const pathParts = location.pathname.split("/").filter((p) => p);
  injectCustomStyles();
  installHistoryListener();

  let avatarEl = document.querySelector(AVATAR_SELECTOR) as HTMLElement;

  let myLogin = await readOwnLogin();
  if (!myLogin) myLogin = "me";
  ownLogin = myLogin;

  const targetLogin =
    pathParts[0] === "users" && pathParts[1] ? pathParts[1] : myLogin;

  if (targetLogin !== lastUser) {
    visualCache = null;
    originalAvatarUrl = null;
    showingOriginalAvatar = false;
    lastUser = targetLogin;
    isFetching = false;
    lastAppliedUser = null;
    lastAppliedKey = null;
    showVisitorLook(null);
    if (avatarEl) avatarEl.style.setProperty("opacity", "1", "important");
  }

  if (!avatarEl) {
    // ~30 frames, but observed instead of polled: the element is picked up on
    // the microtask that follows its insertion (so the avatar stops flashing
    // sooner) and a page without one costs a single observer instead of 30
    // querySelectors spread over half a second of held-up pass.
    avatarEl = (await waitForElement<HTMLElement>(AVATAR_SELECTOR, {
      timeoutMs: AVATAR_WAIT_MS,
    })) as HTMLElement;
    if (!avatarEl) return;
  }

  if (targetLogin === myLogin) {
    void applyOwnProfileExtras(myLogin);
    if (!avatarEl.dataset.modalListener) {
      avatarEl.dataset.modalListener = "true";
      avatarEl.style.cursor = "pointer";
      avatarEl.addEventListener("click", (e) => {
        e.stopPropagation();
        showingOriginalAvatar = false;
        createSettingsModal((updatedVisuals) => {
          visualCache = updatedVisuals;
          setCachedVisuals(targetLogin, updatedVisuals);
          applyImgs(visualCache);
          lastAppliedUser = targetLogin;
          lastAppliedKey = getVisualKey(visualCache);
        });
      });
    }
  }

  if (visualCache) {
    if (document.getElementById("profile-modal-host")) return;
    const key = getVisualKey(visualCache);
    const reapply = needsReapply(visualCache);
    if (lastAppliedUser === targetLogin && lastAppliedKey === key && !reapply) {
      if (targetLogin !== myLogin) {
        showVisitorLook(
          visualCache.look ?? null,
          visualCache.extras ?? null,
          !!visualCache.background,
        );
      }
      return;
    }

    applyImgs(visualCache);
    lastAppliedUser = targetLogin;
    lastAppliedKey = key;
    return;
  }

  if (!isFetching) {
    if (targetLogin === myLogin) {
      // one storage read instead of thirteen serial ones
      const c = await getConfigMany([
        "PROFILE_IMAGE_URL",
        "PROFILE_BANNER_URL",
        "PROFILE_BANNER_MODE",
        "PROFILE_BANNER_COLOR",
        "PROFILE_BACKGROUND_URL",
        "PROFILE_BACKGROUND_MODE",
        "PROFILE_BACKGROUND_COLOR",
        "PROFILE_AVATAR_BG",
        "PROFILE_DECORATION",
        "PROFILE_AVATAR_POSITION_X",
        "PROFILE_AVATAR_POSITION_Y",
        "PROFILE_AVATAR_SCALE",
        "PROFILE_BADGE_BG",
      ] as const);
      visualCache = {
        avatar: c.PROFILE_IMAGE_URL,
        banner: c.PROFILE_BANNER_URL,
        bannerMode: c.PROFILE_BANNER_MODE || "fill",
        bannerColor: c.PROFILE_BANNER_COLOR,
        background: c.PROFILE_BACKGROUND_URL,
        backgroundMode: c.PROFILE_BACKGROUND_MODE || "fill",
        backgroundColor: c.PROFILE_BACKGROUND_COLOR,
        avatarBg: c.PROFILE_AVATAR_BG,
        decoration: c.PROFILE_DECORATION,
        avatarPosX: c.PROFILE_AVATAR_POSITION_X,
        avatarPosY: c.PROFILE_AVATAR_POSITION_Y,
        avatarScale: c.PROFILE_AVATAR_SCALE,
        badgeBg: c.PROFILE_BADGE_BG,
      };
      // sanitise at ingestion so that needsReapply()/getVisualKey() compare
      // exactly what applyImgs() writes (otherwise a normalised URL would
      // look "not applied" and trigger a re-apply on every mutation pass)
      visualCache = sanitizeVisualUrls(visualCache);

      if (
        !visualCache.avatar &&
        !visualCache.banner &&
        !visualCache.bannerColor &&
        !visualCache.background &&
        !visualCache.backgroundColor &&
        !visualCache.badgeBg
      ) {
        avatarEl.style.setProperty("opacity", "1", "important");
      } else if (!document.getElementById("profile-modal-host")) {
        applyImgs(visualCache);
        lastAppliedUser = targetLogin;
        lastAppliedKey = getVisualKey(visualCache);
      }
    } else {
      // Negative cache: a user without cloud visuals used to be re-fetched on
      // every mutation pass. Checked before the storage read (it used to sit
      // after it), those passes now cost nothing at all: visualCache stays
      // null for such a user, so every pass came back here.
      const knownEmptyAt = noVisualsCache.get(targetLogin);
      if (knownEmptyAt && Date.now() - knownEmptyAt < NO_VISUALS_TTL_MS) {
        avatarEl.style.setProperty("opacity", "1", "important");
        return;
      }
      const cached = await getCachedVisuals(targetLogin);
      if (
        cached &&
        (cached.avatar ||
          cached.banner ||
          cached.bannerColor ||
          cached.background ||
          cached.backgroundColor ||
          cached.badgeBg ||
          cached.theme ||
          cached.logtime ||
          cached.look ||
          cached.extras)
      ) {
        visualCache = sanitizeVisualUrls(cached);
        applyImgs(visualCache);
        lastAppliedUser = targetLogin;
        lastAppliedKey = getVisualKey(visualCache);
        if (visualCache.avatar) attachToggleListener(avatarEl);
        revalidateVisuals(targetLogin, cached);
      } else {
        isFetching = true;
        const fetchForLogin = targetLogin;
        try {
          const cloudUrls = await fetchUserVisuals(targetLogin);

          if (fetchForLogin !== lastUser) return;

          if (
            cloudUrls &&
            (cloudUrls.avatar ||
              cloudUrls.banner ||
              cloudUrls.bannerColor ||
              cloudUrls.background ||
              cloudUrls.backgroundColor ||
              cloudUrls.badgeBg ||
              cloudUrls.theme ||
              cloudUrls.logtime ||
              cloudUrls.look ||
              cloudUrls.extras)
          ) {
            visualCache = cloudUrls;
            setCachedVisuals(targetLogin, cloudUrls);
            applyImgs(visualCache);
            lastAppliedUser = targetLogin;
            lastAppliedKey = getVisualKey(visualCache);
            if (cloudUrls.avatar) attachToggleListener(avatarEl);
          } else {
            if (cloudUrls) noVisualsCache.set(targetLogin, Date.now());
            avatarEl.style.setProperty("opacity", "1", "important");
          }
        } finally {
          isFetching = false;
        }
      }
    }
  }
};

const NAV_AVATAR_SELECTOR =
  'img.aspect-square.h-full.w-full[src*="cdn.intra.42.fr"]';
/** Same budget as the old 20 x 250 ms poll. */
const NAV_AVATAR_WAIT_MS = 5000;
let _navAvatarDone = false;

export async function updateNavAvatar(): Promise<void> {
  if (_navAvatarDone) return;
  const customUrl = await getConfig("PROFILE_IMAGE_URL");

  // Observed, not polled: 20 timer wake-ups and 20 document-wide
  // querySelectors on every Intra page became one observer that fires once.
  const img = await waitForElement<HTMLImageElement>(NAV_AVATAR_SELECTOR, {
    timeoutMs: NAV_AVATAR_WAIT_MS,
  });
  if (!img || img.dataset.ftNavAvatar) return;
  img.style.objectFit = "cover";
  if (customUrl) {
    img.src = customUrl;
  }
  img.dataset.ftNavAvatar = "1";
  _navAvatarDone = true;
}
