import { render, html } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import FREEZE_SVG from "../../../assets/svg/freeze.svg?raw";
import { createCountdown } from "../../../core/dom/countdown.ts";
import { tickWhileVisible, waitForElement } from "../../../core/dom/dom-wait.ts";
import {
  parseIntraDate,
  waitForIntrapyToken,
} from "../../../core/intra/intrapy.ts";
import { getConfig } from "../../../core/config.ts";

const INJECTED_ID = "ft-freeze-card";

/** How long to wait for the page to hand over a usable Intra token. */
const TOKEN_WAIT_MS = 20000;

async function fetchCursusData(login: string, token: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://intrapy.intra.42.fr/api/v1/users/${login}/cursus`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) {
      console.warn("fetchCursusData: non-ok response", res.status);
      return [];
    }
    return await res.json();
  } catch (e) {
    console.warn("fetchCursusData: network error", e);
    return [];
  }
}

function formatDate(iso: string): string {
  const d = parseIntraDate(iso);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getCountdownParts(endIso: string): number[] {
  const diff = parseIntraDate(endIso).getTime() - Date.now();
  if (diff <= 0) return [0, 0, 0, 0];
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return [d, h, m, s];
}

function startCountdown(
  container: HTMLElement,
  endIso: string,
  color: string,
): void {
  const countdown = createCountdown(getCountdownParts(endIso), {
    digits: 2,
  });
  countdown.el.style.cssText =
    `font-size: 1.5rem; font-weight: 700; color: ${color};`;
  container.appendChild(countdown.el);

  stopCountdown();
  // Computed from Date.now() on every tick, so pausing it in a background tab
  // loses nothing: the first tick after the tab comes back is right again.
  // It also stops by itself once the card has left the page.
  const stop = tickWhileVisible(
    () => {
      if (parseIntraDate(endIso).getTime() - Date.now() <= 0) {
        countdown.update([0, 0, 0, 0]);
        if (_stopCountdown === stop) _stopCountdown = null;
        return true;
      }
      countdown.update(getCountdownParts(endIso));
    },
    1000,
    { element: countdown.el },
  );
  _stopCountdown = stop;
}

let _running = false;
let _stopCountdown: (() => void) | null = null;

function stopCountdown(): void {
  if (_stopCountdown !== null) {
    _stopCountdown();
    _stopCountdown = null;
  }
}

// The countdown clears its own timer on pagehide (tickWhileVisible), and
// picks it up again if the page comes back from the bfcache.
window.addEventListener(
  "pagehide",
  () => {
    _running = false;
  },
  { once: true },
);

const FREEZE_CACHE_KEY = "FREEZE_CACHE";

async function readFreezeCache(login: string): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get(FREEZE_CACHE_KEY);
    const raw = stored[FREEZE_CACHE_KEY];
    const map = (typeof raw === "string" ? JSON.parse(raw) : raw) || {};
    const until = map[login];
    return typeof until === "string" &&
      parseIntraDate(until).getTime() > Date.now()
      ? until
      : null;
  } catch {
    return null;
  }
}

async function writeFreezeCache(login: string, until: string | null) {
  try {
    const stored = await chrome.storage.local.get(FREEZE_CACHE_KEY);
    const raw = stored[FREEZE_CACHE_KEY];
    const map = (typeof raw === "string" ? JSON.parse(raw) : raw) || {};
    if (until) {
      map[login] = until;
    } else {
      delete map[login];
    }
    await chrome.storage.local.set({
      [FREEZE_CACHE_KEY]: JSON.stringify(map),
    });
  } catch {
    /* the card still works without the cache */
  }
}

function removeFreezeCard() {
  document.getElementById(INJECTED_ID)?.remove();
  stopCountdown();
}

/**
 * The first child of the profile row. `row > :first-child` resolves to the
 * same node as the old `querySelector(row).firstElementChild` (the first row
 * in document order is the first to have a first child), found on the
 * mutation instead of by polling every animation frame - a loop that, in a
 * background tab, did not run at all.
 */
const PROFILE_CARD_SELECTOR =
  ".flex.flex-col.lg\\:flex-row.gap-6.md\\:gap-8 > :first-child";
/** The old loop gave up after 60 animation frames, about one second. */
const PROFILE_CARD_TIMEOUT_MS = 1000;

function waitForProfileCard(): Promise<HTMLElement | null> {
  return waitForElement<HTMLElement>(PROFILE_CARD_SELECTOR, {
    timeoutMs: PROFILE_CARD_TIMEOUT_MS,
  });
}

function buildFreezeCard(profileCard: HTMLElement, freezeUntil: string) {
  const color =
    getComputedStyle(profileCard).getPropertyValue("--user-color").trim() ||
    "#00babc";

  const card = document.createElement("div");
  card.id = INJECTED_ID;
  card.dataset.freezeUntil = freezeUntil;
  card.className =
    "border border-ft-gray-border bg-ft-gray/50 rounded-xl flex flex-col items-center justify-center gap-2 w-full";
  card.style.cssText = `min-height: 200px;`;

  const iconWrap = document.createElement("div");
  iconWrap.className = "ft-freeze-spin";
  iconWrap.style.cssText = `width: 2.5rem; height: 2.5rem; color: #fff;`;
  if (!document.getElementById("ft-freeze-spin-style")) {
    const style = document.createElement("style");
    style.id = "ft-freeze-spin-style";
    // A class rather than an inline animation, so that the reduced-motion
    // preference and the "Disable animations" switch can stop it.
    style.textContent = [
      "@keyframes ft-freeze-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }",
      ".ft-freeze-spin { animation: ft-freeze-spin 8s linear infinite; }",
      "@media (prefers-reduced-motion: reduce) { .ft-freeze-spin { animation: none; } }",
      "html.ft-freeze-still .ft-freeze-spin { animation: none; }",
    ].join("\n");
    document.head.appendChild(style);
    void getConfig("DISABLE_ANIMATIONS").then((disabled) => {
      if (disabled) document.documentElement.classList.add("ft-freeze-still");
    });
  }
  render(unsafeHTML(FREEZE_SVG), iconWrap);

  const title = document.createElement("div");
  title.style.cssText = `font-size: 1.25rem; font-weight: 700; color: ${color};`;
  title.textContent = "Freeze";

  const until = document.createElement("div");
  until.style.cssText = `font-size: 1rem; font-weight: 700; opacity: 0.7;`;
  until.textContent = `Until ${formatDate(freezeUntil)}`;

  const countdownContainer = document.createElement("div");
  startCountdown(countdownContainer, freezeUntil, color);

  card.appendChild(iconWrap);
  card.appendChild(title);
  card.appendChild(until);
  card.appendChild(countdownContainer);

  const infoHost = document.getElementById("profile-badges-shadow");
  const target = infoHost ?? profileCard;
  target.insertAdjacentElement("afterend", card);
}

export async function initFreezeCard() {
  if (_running) return;
  _running = true;

  try {
    const pathParts = location.pathname.split("/").filter(Boolean);
    if (pathParts[0] !== "users" || !pathParts[1]) return;

    const existingCard = document.getElementById(INJECTED_ID);
    if (existingCard) return;

    const targetLogin = pathParts[1];

    // A freeze that was still running on the last visit is drawn right away,
    // so the card does not push the page down once the intra API answers. The
    // cached date is only trusted while it is in the future, and the response
    // below either confirms it or drops the card.
    const cached = await readFreezeCache(targetLogin);
    if (cached && !document.getElementById(INJECTED_ID)) {
      const profileCard = await waitForProfileCard();
      if (profileCard && !document.getElementById(INJECTED_ID)) {
        buildFreezeCard(profileCard, cached);
      }
    }

    const token = await waitForIntrapyToken(TOKEN_WAIT_MS);
    if (!token) return;

    const cursusList = await fetchCursusData(targetLogin, token);
    if (!Array.isArray(cursusList) || cursusList.length === 0) return;

    const frozen = cursusList.find(
      (c: any) =>
        c.freeze_until &&
        parseIntraDate(c.freeze_until).getTime() > Date.now(),
    );
    const freezeUntil: string | null = frozen?.freeze_until ?? null;
    await writeFreezeCache(targetLogin, freezeUntil);

    if (!freezeUntil) {
      removeFreezeCard();
      return;
    }

    const shown = document.getElementById(INJECTED_ID);
    if (shown?.dataset.freezeUntil === freezeUntil) return;

    removeFreezeCard();
    const profileCard = await waitForProfileCard();
    if (!profileCard) return;
    buildFreezeCard(profileCard, freezeUntil);
  } finally {
    if (!document.getElementById(INJECTED_ID)) _running = false;
  }
}
