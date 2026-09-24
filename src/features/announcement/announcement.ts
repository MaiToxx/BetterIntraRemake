import { html, render } from "lit-html";
import { sanitizeHttpUrl } from "../../core/security/safe-url.ts";
import { msg, t } from "../../core/i18n/i18n.ts";

import { WORKER_URL } from "../../core/worker.ts";
const CACHE_TTL = 5 * 60 * 1000;
/**
 * Both live in chrome.storage.local, not sessionStorage: a student with the
 * Intra open in several tabs dismissed the same banner once per tab (and
 * again after every restart), and each tab fetched /announcement on its own.
 * Neither key is a setting (not in CONFIG_DEFAULT), so backup export and
 * cloud sync ignore them, like UPDATE_AVAILABLE.
 */
export const CACHE_KEY = "ANNOUNCEMENT_CACHE";
export const DISMISSED_KEY = "ANNOUNCEMENT_DISMISSED";

type AnnouncementLevel = "info" | "warning" | "critical";

interface AnnouncementLink {
  text: string;
  url: string;
}

interface Announcement {
  message: string | null;
  updatedAt: number | null;
  level: AnnouncementLevel;
  links?: AnnouncementLink[];
}

/** `label` is an English key (msg), translated with t() when drawn. */
const LEVEL_STYLES: Record<
  AnnouncementLevel,
  { bg: string; fg: string; label: string }
> = {
  info: { bg: "#2563eb", fg: "#fff", label: msg("Notice") },
  warning: { bg: "#f59e0b", fg: "#1f2937", label: msg("Warning") },
  critical: { bg: "#ef4444", fg: "#fff", label: msg("Critical") },
};

const isProfileHost = () =>
  window.location.hostname === "profile.intra.42.fr" ||
  window.location.hostname === "profile-v3.intra.42.fr";

type CacheEntry = { data: Announcement; timestamp: number };

async function readStored(): Promise<{ cache: CacheEntry | null; dismissed: string | null }> {
  try {
    const got = await chrome.storage.local.get([CACHE_KEY, DISMISSED_KEY]);
    const cache = got[CACHE_KEY] as CacheEntry | undefined;
    const dismissed = got[DISMISSED_KEY];
    return {
      cache: cache && typeof cache.timestamp === "number" && cache.data ? cache : null,
      dismissed: typeof dismissed === "string" ? dismissed : null,
    };
  } catch {
    return { cache: null, dismissed: null };
  }
}

async function setCached(data: Announcement): Promise<void> {
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: { data, timestamp: Date.now() } });
  } catch {
    /* ignore */
  }
}

/**
 * The announcement's id: a hash of what the student saw. A re-worded
 * announcement gets a new id and shows again; the same one stays dismissed.
 */
export function announcementId(
  message: string,
  level: string,
  links: AnnouncementLink[],
): string {
  let hash = 0;
  const input = `${message}::${level}::${links.map((l) => `${l.text}|${l.url}`).join(",")}`;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function renderBanner(
  message: string,
  level: AnnouncementLevel,
  links: AnnouncementLink[],
): void {
  const style = LEVEL_STYLES[level] ?? LEVEL_STYLES.critical;

  const dismiss = () => {
    const el = document.getElementById("ft-announcement-banner");
    if (el) el.remove();
    try {
      void chrome.storage.local.set({
        [DISMISSED_KEY]: announcementId(message, level, links),
      });
    } catch {
      /* ignore */
    }
  };

  const banner = document.createElement("div");
  banner.id = "ft-announcement-banner";

  render(
    html`
      <style>
        #ft-announcement-banner {
          position: relative;
          z-index: 999999;
        }
        .ft-announcement-bnr {
          background: ${style.bg};
          color: ${style.fg};
          padding: 10px 20px;
          text-align: center;
          font-family:
            system-ui,
            -apple-system,
            sans-serif;
          font-size: 14px;
          font-weight: 500;
          line-height: 1.4;
          position: relative;
        }
        .ft-announcement-level {
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-right: 6px;
        }
        .ft-announcement-dismiss {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 20px;
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: inherit;
          opacity: 0.7;
          line-height: 1;
          padding: 4px 8px;
        }
        .ft-announcement-dismiss:hover {
          opacity: 1;
        }
        .ft-announcement-links {
          display: inline-flex;
          gap: 8px;
          margin-left: 8px;
          vertical-align: middle;
        }
        .ft-announcement-link {
          color: inherit;
          font-weight: 700;
          text-decoration: underline;
        }
      </style>
      <div class="ft-announcement-bnr">
        <strong class="ft-announcement-level">[${t(style.label)}]</strong>
        ${message}
        ${links.length > 0
          ? html`<span class="ft-announcement-links">
              ${links
                .map((l) => ({ text: l.text, url: sanitizeHttpUrl(l.url) }))
                .filter((l) => l.url !== "")
                .map(
                  (l) =>
                    html`<a
                      class="ft-announcement-link"
                      href="${l.url}"
                      target="_blank"
                      rel="noopener noreferrer"
                      >${l.text}</a
                    >`,
                )}
            </span>`
          : ""}
        <button
          class="ft-announcement-dismiss"
          @click="${dismiss}"
          title="${t("Dismiss")}"
          aria-label="${t("Dismiss")}"
        >
          &times;
        </button>
      </div>
    `,
    banner,
  );

  const tryInject = () => {
    if (document.body) {
      document.body.insertBefore(banner, document.body.firstChild);
    } else {
      requestAnimationFrame(tryInject);
    }
  };
  tryInject();

  // Dismissed in another tab: this one's copy goes too.
  try {
    const id = announcementId(message, level, links);
    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes[DISMISSED_KEY]?.newValue !== id) return;
      banner.remove();
      chrome.storage.onChanged.removeListener(onChanged);
    };
    chrome.storage.onChanged?.addListener(onChanged);
  } catch {
    /* ignore */
  }
}

function showUnlessDismissed(data: Announcement, dismissed: string | null): void {
  if (!data.message) return;
  const links = data.links ?? [];
  if (announcementId(data.message, data.level, links) === dismissed) return;
  renderBanner(data.message, data.level, links);
}

export async function initAnnouncementBanner(): Promise<void> {
  if (!isProfileHost()) return;
  if (document.getElementById("ft-announcement-banner")) return;

  try {
    const { cache, dismissed } = await readStored();
    if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
      showUnlessDismissed(cache.data, dismissed);
      return;
    }

    const res = await fetch(`${WORKER_URL}/api/v1/public/announcement`);
    if (!res.ok) return;
    const data = (await res.json()) as Announcement;
    await setCached(data);
    showUnlessDismissed(data, dismissed);
  } catch {
    /* never break intra */
  }
}
