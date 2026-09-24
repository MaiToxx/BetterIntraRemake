/**
 * Easter eggs. Nine small secrets hidden in the Intra, all local, all
 * harmless, all switched off together with the "Easter eggs" setting.
 *
 *   konami    ↑ ↑ ↓ ↓ ← → ← → B A          party mode (confetti + colours)
 *   barrel    type "barrel"                 the page does a barrel roll
 *   matrix    type "matrix"                 digital rain for a few seconds
 *   hacker    click the hub gear 7 times    unlocks the "🐇 Hacker" preset
 *             in a row (under 5 s apart)
 *   night     open the Intra between 2 and 5 am
 *   thursday  visit the dashboard on a Thursday (roulette day)
 *   fortytwo  a month at exactly 42h of logtime
 *   maxwell   type "maxwell"                a certain cat crosses the screen, spinning
 *   invasion  type it again while he is there  the screen fills with Maxwells
 *
 * Every secret found is remembered in EGGS_FOUND (local only) and counted
 * in the About tab.
 *
 * With reduced motion (the OS preference, or the Advanced "Disable
 * animations" switch) a secret is still found and announced, but nothing
 * moves: no barrel roll, no hue cycling, no confetti, no digital rain, and
 * Maxwell stands still instead of walking and spinning.
 */
import { html, render } from "lit-html";
import { getConfigMany } from "../../core/config.ts";
import { tickWhileVisible, waitForElement, watchDom } from "../../core/dom/dom-wait.ts";
import { savePreset } from "../customize/presets.ts";
import { defaultCustomization } from "../customize/customize.ts";
import { initI18n, t } from "../../core/i18n/i18n.ts";

export const EGG_IDS = [
  "konami",
  "barrel",
  "matrix",
  "hacker",
  "night",
  "thursday",
  "fortytwo",
  "maxwell",
  "invasion",
] as const;
export type EggId = (typeof EGG_IDS)[number];
export const EGGS_KEY = "EGGS_FOUND";

const SEQUENCES: Record<string, string[]> = {
  konami: [
    "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
  ],
  barrel: [..."barrel"],
  matrix: [..."matrix"],
  maxwell: [..."maxwell"],
};

/**
 * Pure key-sequence matcher: feed it key names, it calls onMatch(id) when
 * one of the sequences was just typed. Keeps only the last N keys.
 */
export function createSequenceMatcher(
  sequences: Record<string, string[]>,
  onMatch: (id: string) => void,
): (key: string) => void {
  const maxLen = Math.max(...Object.values(sequences).map((s) => s.length));
  let buffer: string[] = [];
  return (key: string) => {
    buffer.push(key.length === 1 ? key.toLowerCase() : key);
    if (buffer.length > maxLen) buffer = buffer.slice(-maxLen);
    for (const [id, seq] of Object.entries(sequences)) {
      if (buffer.length < seq.length) continue;
      const tail = buffer.slice(-seq.length);
      if (tail.every((k, i) => k === seq[i])) {
        buffer = [];
        onMatch(id);
        return;
      }
    }
  };
}

export async function listFoundEggs(): Promise<EggId[]> {
  const store = await chrome.storage.local.get(EGGS_KEY);
  const raw = store[EGGS_KEY];
  if (!Array.isArray(raw)) return [];
  return EGG_IDS.filter((id) => raw.includes(id));
}

/** Remember a found secret; returns true the first time it is found. */
export async function recordEgg(id: EggId): Promise<boolean> {
  const found = await listFoundEggs();
  if (found.includes(id)) return false;
  await chrome.storage.local.set({ [EGGS_KEY]: [...found, id] });
  return true;
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

/**
 * Set by initEasterEggs (and refreshed by gearClicked) from the Advanced
 * "Disable animations" switch.
 */
let animationsDisabled = false;

/** The OS asks for less motion, or the user switched animations off here. */
function prefersStill(): boolean {
  if (animationsDisabled) return true;
  try {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

const TOAST_ID = "ft-egg-toast";
/** How long after the live region exists its text is written (see toast()). */
const TOAST_ANNOUNCE_DELAY_MS = 50;
let toastHide: ReturnType<typeof setTimeout> | undefined;
let toastAnnounce: ReturnType<typeof setTimeout> | undefined;

/**
 * The pill at the bottom of the screen. Its text is there at once, as before
 * (the profile greeting reads it back), but hidden from screen readers: what
 * they hear is a separate, visually hidden polite live region, written a
 * moment later. A region is announced when its text CHANGES, not when it is
 * inserted with it; emptied first, a repeated message is read again. The
 * <style> sits outside both.
 */
export function toast(message: string, ms = 4500): void {
  let host = document.getElementById(TOAST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = TOAST_ID;
    (document.body || document.documentElement).appendChild(host);
  }
  // The pill is sized to its text, up to the viewport less a margin: with
  // only left: 50%, a fixed box is never wider than half the viewport, so a
  // longer message (French, a profile greeting) wrapped with room to spare.
  // Border-box because the page decides the default box model. The 20px
  // radius is a pill on one line (about 40px tall) and a rounded box on two,
  // where 999px made a lens.
  render(
    html`<style>
        #${TOAST_ID} {
          position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
          z-index: 2147483000; padding: 10px 16px;
          box-sizing: border-box; width: max-content;
          max-width: min(40rem, calc(100vw - 32px));
          text-align: center; overflow-wrap: anywhere; border-radius: 20px;
          font: 500 14px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
          background: hsl(var(--card, 220 20% 10%)); color: hsl(var(--card-foreground, 0 0% 95%));
          border: 1px solid hsl(var(--primary, 181 100% 37%));
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
          animation: ft-egg-in 0.35s ease-out;
        }
        #${TOAST_ID}.still { animation: none; }
        #${TOAST_ID} [role="status"] {
          position: absolute; width: 1px; height: 1px; overflow: hidden;
          clip-path: inset(50%); white-space: nowrap;
        }
        @keyframes ft-egg-in { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @media (prefers-reduced-motion: reduce) { #${TOAST_ID} { animation: none; } }
      </style>
      <span aria-hidden="true">${message}</span>
      <span role="status" aria-live="polite" aria-atomic="true"></span>`,
    host,
  );
  host.classList.toggle("still", prefersStill());
  const region = host.querySelector<HTMLElement>('[role="status"]');
  if (region) region.textContent = "";
  clearTimeout(toastAnnounce);
  toastAnnounce = setTimeout(() => {
    if (region) region.textContent = message;
  }, TOAST_ANNOUNCE_DELAY_MS);
  // One timer for the pill: each toast used to schedule its own removal, and
  // the first one's cut the second short.
  clearTimeout(toastHide);
  const mine = host;
  toastHide = setTimeout(() => {
    if (mine.isConnected) mine.remove();
  }, ms);
}

function canvasOverlay(seconds: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; stop: () => void } | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147482000;";
  document.body.appendChild(canvas);
  const stop = () => canvas.remove();
  setTimeout(stop, seconds * 1000);
  return { canvas, ctx, stop };
}

export function confetti(): void {
  const o = canvasOverlay(3.5);
  if (!o) return;
  const { canvas, ctx } = o;
  const colors = ["#00babc", "#ff5f56", "#ffbd2e", "#27c93f", "#7c3aed", "#ffffff"];
  const parts = Array.from({ length: 180 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 4,
    r: 4 + Math.random() * 6,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (t: number) => {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (t - start < 3400) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function partyMode(seconds = 8): void {
  confetti();
  const id = "ft-egg-party";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `@keyframes ft-egg-hue { to { filter: hue-rotate(360deg); } }
    html { animation: ft-egg-hue 3s linear infinite; }`;
  document.head.appendChild(style);
  setTimeout(() => style.remove(), seconds * 1000);
}

export function barrelRoll(): void {
  const el = document.documentElement;
  el.style.transition = "transform 1.2s ease-in-out";
  el.style.transform = "rotate(360deg)";
  setTimeout(() => {
    el.style.transition = "";
    el.style.transform = "";
  }, 1300);
}

export function matrixRain(seconds = 7): void {
  const o = canvasOverlay(seconds);
  if (!o) return;
  const { canvas, ctx } = o;
  const size = 16;
  const cols = Math.floor(canvas.width / size);
  const drops = Array.from({ length: cols }, () => Math.random() * -50);
  const glyphs = "アイウエオカキクケコサシスセソ0123456789ABCDEF42";
  // The same 45 ms frame while the tab is visible; nothing is drawn behind a
  // hidden tab, and the loop ends with the canvas (removed by canvasOverlay).
  tickWhileVisible(
    () => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00ff41";
      ctx.font = `${size}px monospace`;
      drops.forEach((y, i) => {
        const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
        ctx.fillText(ch, i * size, y * size);
        drops[i] = y * size > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
      });
    },
    45,
    { element: canvas },
  );
}

/**
 * Maxwell: a tuxedo cat (drawn here, no image download) that walks across
 * the bottom of the screen while spinning, as the meme demands. Click it
 * for a faster spin.
 */
/** The cat itself, reused by the single walk and the invasion. */
const catSvg = (onClick?: (e: Event) => void) => html`
      <svg viewBox="0 0 140 120" xmlns="http://www.w3.org/2000/svg" @click=${onClick}>
        <title>Maxwell</title>
        <!-- body -->
        <ellipse cx="70" cy="82" rx="46" ry="30" fill="#111" />
        <ellipse cx="70" cy="90" rx="26" ry="18" fill="#fff" />
        <!-- legs -->
        <rect x="38" y="98" width="12" height="18" rx="5" fill="#111" />
        <rect x="56" y="100" width="12" height="18" rx="5" fill="#fff" />
        <rect x="74" y="100" width="12" height="18" rx="5" fill="#fff" />
        <rect x="92" y="98" width="12" height="18" rx="5" fill="#111" />
        <!-- tail -->
        <path d="M114 74 q26 -8 18 -34" stroke="#111" stroke-width="9" fill="none" stroke-linecap="round" />
        <!-- head -->
        <circle cx="52" cy="46" r="28" fill="#111" />
        <polygon points="30,30 26,4 46,20" fill="#111" />
        <polygon points="74,30 78,4 58,20" fill="#111" />
        <polygon points="32,27 30,11 42,21" fill="#f4a7b9" />
        <polygon points="72,27 74,11 62,21" fill="#f4a7b9" />
        <ellipse cx="52" cy="58" rx="16" ry="11" fill="#fff" />
        <ellipse cx="40" cy="45" rx="6" ry="7" fill="#f5c518" />
        <ellipse cx="64" cy="45" rx="6" ry="7" fill="#f5c518" />
        <ellipse cx="40" cy="45" rx="2" ry="6" fill="#111" />
        <ellipse cx="64" cy="45" rx="2" ry="6" fill="#111" />
        <path d="M48 55 l4 4 l4 -4 z" fill="#f4a7b9" />
        <path d="M52 59 v4 m0 0 q-4 5 -8 1 m8 -1 q4 5 8 1" stroke="#111" stroke-width="1.5" fill="none" />
        <path d="M20 52 l16 2 M20 60 l16 -2 M84 52 l-16 2 M84 60 l-16 -2" stroke="#ddd" stroke-width="1.2" />
      </svg>`;

/**
 * `still`: he sits in the bottom-left corner for the same time instead of
 * walking across and spinning (reduced motion).
 */
export function maxwell(seconds = 9, still = false): void {
  const id = "ft-egg-maxwell";
  if (document.getElementById(id)) return;
  const host = document.createElement("div");
  host.id = id;
  if (still) host.classList.add("still");
  const remove = () => host.remove();
  render(
    html`<style>
        #${id} {
          position: fixed; bottom: 12px; left: -160px; z-index: 2147482500;
          width: 140px; height: 120px; cursor: pointer; perspective: 600px;
          animation: ft-mx-walk ${seconds}s linear forwards;
        }
        #${id} svg { width: 100%; height: 100%; animation: ft-mx-spin 1.6s linear infinite; transform-style: preserve-3d; }
        #${id}.fast svg { animation-duration: 0.45s; }
        #${id}.still { left: 16px; animation: none; cursor: default; }
        #${id}.still svg { animation: none; }
        @keyframes ft-mx-walk { from { left: -160px; } to { left: 100vw; } }
        @keyframes ft-mx-spin { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
        @media (prefers-reduced-motion: reduce) { #${id} svg { animation: none; } }
      </style>
      ${catSvg(still ? undefined : () => host.classList.toggle("fast"))}`,
    host,
  );
  (document.body || document.documentElement).appendChild(host);
  setTimeout(remove, seconds * 1000 + 200);
}

/**
 * Full Maxwell: the whole screen fills with spinning cats of every size,
 * each on its own drift and spin. Typing "maxwell" again while a cat is
 * on screen summons them.
 */
export function maxwellInvasion(seconds = 12, count = 48, still = false): void {
  const id = "ft-egg-maxwells";
  if (document.getElementById(id)) return;
  const host = document.createElement("div");
  host.id = id;
  // Reduced motion: the cats are all there, but none of them drifts or spins.
  if (still) host.classList.add("still");
  const cats = Array.from({ length: count }, (_, i) => ({
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: 60 + Math.random() * 160,
    spin: 0.6 + Math.random() * 2,
    drift: 4 + Math.random() * 8,
    delay: -Math.random() * 8,
    dir: i % 2 ? 1 : -1,
  }));
  render(
    html`<style>
        #${id} { position: fixed; inset: 0; z-index: 2147482400; pointer-events: none; overflow: hidden; perspective: 800px; }
        #${id} .cat { position: absolute; transform: translate(-50%, -50%); animation: ft-mxs-drift var(--drift) ease-in-out infinite alternate; animation-delay: var(--delay); }
        #${id} .cat svg { width: 100%; height: 100%; animation: ft-mx-spin var(--spin) linear infinite; transform-style: preserve-3d; }
        @keyframes ft-mxs-drift { from { margin-top: -6vh; margin-left: calc(var(--dir) * -6vw); } to { margin-top: 6vh; margin-left: calc(var(--dir) * 6vw); } }
        @keyframes ft-mx-spin { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
        #${id}.still .cat, #${id}.still .cat svg { animation: none; }
        @media (prefers-reduced-motion: reduce) { #${id} .cat, #${id} .cat svg { animation: none; } }
      </style>
      ${cats.map(
        (c) => html`<div
          class="cat"
          style="left:${c.left}%;top:${c.top}%;width:${c.size}px;height:${c.size * 0.86}px;--spin:${c.spin}s;--drift:${c.drift}s;--delay:${c.delay}s;--dir:${c.dir}"
        >
          ${catSvg()}
        </div>`,
      )}`,
    host,
  );
  (document.body || document.documentElement).appendChild(host);
  setTimeout(() => host.remove(), seconds * 1000);
}

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

const TOTAL = EGG_IDS.length;

/** `message` is already translated (a t() at the call site). */
async function found(id: EggId, message: string): Promise<void> {
  let first = false;
  let n = 0;
  try {
    first = await recordEgg(id);
    n = (await listFoundEggs()).length;
  } catch {
    // Storage gone: Chrome keeps an updated extension's old script running in
    // the open tabs, without its APIs. The secret still shows.
  }
  toast(first ? t("{message} · secret {n}/{total} found", { message, n, total: TOTAL }) : message);
}

/** Longest pause between two gear clicks that still counts as "in a row". */
const GEAR_PAUSE_MS = 5000;
let gearClicks = 0;
let lastGearClick = 0;

/**
 * Called from the hub gear: seven clicks in a row unlock a preset. Each click
 * opens the hub, a modal the gear sits behind, so every click is an open and
 * an Escape: seven of those within four seconds (the old rule) was out of
 * reach. A pause of up to five seconds between two clicks is allowed.
 */
export async function gearClicked(): Promise<void> {
  const now = Date.now();
  gearClicks = now - lastGearClick <= GEAR_PAUSE_MS ? gearClicks + 1 : 1;
  lastGearClick = now;
  if (gearClicks < 7) return;
  gearClicks = 0;
  const { EASTER_EGGS_ENABLED, DISABLE_ANIMATIONS } = await getConfigMany([
    "EASTER_EGGS_ENABLED",
    "DISABLE_ANIMATIONS",
  ]);
  if (EASTER_EGGS_ENABLED === false) return;
  animationsDisabled = DISABLE_ANIMATIONS === true;
  await savePreset("🐇 Hacker", {
    ...defaultCustomization(),
    CUSTOM_ACCENT_ENABLED: true,
    CUSTOM_ACCENT_COLOR: "#00ff41",
    CUSTOM_THEME_ENABLED: true,
    CUSTOM_THEME_BG: "#000000",
    CUSTOM_THEME_CARD: "#050d05",
    CUSTOM_THEME_TEXT: "#b3ffb3",
    CUSTOM_FONT: "mono",
    CUSTOM_CARD_STYLE: "outlined",
    CUSTOM_SCROLLBAR: "accent",
    CUSTOM_PAGE_BG_PRESET: "mono",
  });
  if (!prefersStill()) matrixRain(4);
  await found("hacker", t("Wake up, Neo… the 🐇 Hacker preset is in Customize > Presets"));
}

/** Inputs that take no text: a key pressed on one of them is not typing. */
const NON_TEXT_INPUTS = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"];

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  // A closed shadow root hides its field from the composed path, which then
  // starts at the host: the host carries data-ft-typing while one of its
  // fields has focus (the cluster map's search box).
  if (el.dataset?.ftTyping !== undefined) return true;
  const tag = el.tagName;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.includes((el as HTMLInputElement).type);
  return tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * Whether a key event was typed into a field. On a document listener
 * `e.target` is the shadow HOST for a field inside a shadow root (every hub
 * field, the friends login box, the preset names...), while the composed
 * path still starts at the field itself.
 */
function isTypingEvent(e: Event): boolean {
  const path = typeof e.composedPath === "function" ? e.composedPath() : [];
  return isTypingTarget(path[0] ?? e.target);
}

/**
 * "YYYY-MM-DD" of the local day. Not toISOString(): that is the UTC day, while
 * the checks below read the local hour and weekday. In Paris between 00:00
 * and 02:00 a Thursday was keyed under Wednesday's date, so its toast came
 * back later that day.
 */
function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function checkTimeAndDay(): void {
  const now = new Date();
  const h = now.getHours();
  const dayKey = localDayKey(now);
  if (h >= 2 && h < 5 && localStorage.getItem("ft-egg-night") !== dayKey) {
    localStorage.setItem("ft-egg-night", dayKey);
    void found("night", t("{h}h. The cluster never closes, but you could 😴", { h }));
  }
  if (now.getDay() === 4 && location.pathname === "/") {
    // Found on the mutation that adds the card instead of by a 500 ms poll.
    void waitForElement<HTMLElement>(ROULETTE_TITLE, {
      timeoutMs: THURSDAY_WAIT_MS,
    }).then((title) => {
      if (!title || title.dataset.ftEgg) return;
      title.dataset.ftEgg = "1";
      title.textContent = `🎰 ${title.textContent ?? ""}`;
      if (localStorage.getItem("ft-egg-thursday") !== dayKey) {
        localStorage.setItem("ft-egg-thursday", dayKey);
        void found("thursday", t("It's roulette day. May the odds be ever in your favour 🎰"));
      }
    });
  }
}

const ROULETTE_TITLE = '[data-ft-card="roulette"] [class*="uppercase"]';
/** The old loops looked 31 and 41 times, 500 ms apart: same deadlines. */
const THURSDAY_WAIT_MS = 15_500;
const FORTY_TWO_WAIT_MS = 20_500;

/** Month badge of the logtime widget reading exactly "42h00". */
function checkFortyTwoHours(): void {
  if (location.pathname !== "/") return;

  let celebrated = false;
  const badgeHit = (root: ShadowRoot | null): boolean => {
    if (celebrated) return true;
    const badges = root ? Array.from(root.querySelectorAll(".badge")) : [];
    const hit = badges.some((b) => /^\s*42h00\b/.test(b.textContent ?? ""));
    if (!hit) return false;
    celebrated = true;
    const monthKey = localDayKey(new Date()).slice(0, 7);
    if (localStorage.getItem("ft-egg-42") !== monthKey) {
      localStorage.setItem("ft-egg-42", monthKey);
      if (!prefersStill()) confetti();
      void found("fortytwo", t("42h00 this month. The answer to everything ✨"));
    }
    return true;
  };

  // The widget renders into its own shadow root, which an observer on the
  // document does not see. So: watch the document for the widget (it can be
  // replaced), and the widget's root for the badge - text included, since lit
  // updates a text binding in place. One deadline for both, as before.
  let watched: ShadowRoot | null = null;
  let stopShadow: (() => void) | null = null;
  const unwatchShadow = () => {
    stopShadow?.();
    stopShadow = null;
    watched = null;
  };
  let stop: () => void = () => {};
  stop = watchDom(
    () => {
      const root =
        document.getElementById("logtime-shadow-wrapper")?.shadowRoot ?? null;
      // Same widget: its badges can only change inside its root, which the
      // inner watcher covers. Nothing to look at for this document burst.
      if (root === watched) return false;
      unwatchShadow();
      if (!root) return false;
      watched = root;
      stopShadow = watchDom(
        () => {
          if (!badgeHit(root)) return false;
          stop();
          return true;
        },
        { root, timeoutMs: 0, immediate: false, characterData: true },
      );
      return badgeHit(root);
    },
    { timeoutMs: FORTY_TWO_WAIT_MS, onStop: unwatchShadow },
  );
}

let initialised = false;
/** The "Easter eggs" switch, followed live; off until the setting is read. */
let enabled = false;

export async function initEasterEggs(): Promise<void> {
  if (initialised) return;
  initialised = true;

  const feed = createSequenceMatcher(SEQUENCES, (id) => {
    // Asked at each hit: the OS preference can change while the page is open.
    const still = prefersStill();
    if (id === "konami") {
      if (!still) partyMode();
      void found("konami", t("Party mode 🎉"));
    } else if (id === "barrel") {
      if (!still) barrelRoll();
      void found("barrel", t("Do a barrel roll! 🛩️"));
    } else if (id === "matrix") {
      if (!still) matrixRain();
      void found("matrix", t("There is no spoon 🥄"));
    } else if (id === "maxwell") {
      if (document.getElementById("ft-egg-maxwell")) {
        maxwellInvasion(undefined, undefined, still);
        void found("invasion", t("FULL MAXWELL 🐈‍⬛🐈‍⬛🐈‍⬛"));
      } else {
        maxwell(undefined, still);
        void found(
          "maxwell",
          still
            ? t("Maxwell 🐈‍⬛ (type his name again for more)")
            : t("Maxwell 🐈‍⬛ (click him to spin faster, type his name again for more)"),
        );
      }
    }
  });
  // On the window, in the capture phase, and before the settings are read:
  // the first listener to see a key, so no handler of the page can stop it
  // on the way, and the switch below decides at each key. It used to be a
  // document listener added after the read, and only when the switch was on
  // at page load: turning it on in the hub did nothing until a reload.
  window.addEventListener(
    "keydown",
    (e) => {
      if (!enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      // Chrome's autofill sends keydown events without a key.
      if (typeof e.key !== "string" || isTypingEvent(e)) return;
      feed(e.key);
    },
    true,
  );
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.EASTER_EGGS_ENABLED) enabled = changes.EASTER_EGGS_ENABLED.newValue !== false;
    if (changes.DISABLE_ANIMATIONS) animationsDisabled = changes.DISABLE_ANIMATIONS.newValue === true;
  });

  const { EASTER_EGGS_ENABLED, DISABLE_ANIMATIONS } = await getConfigMany([
    "EASTER_EGGS_ENABLED",
    "DISABLE_ANIMATIONS",
  ]);
  enabled = EASTER_EGGS_ENABLED !== false;
  animationsDisabled = DISABLE_ANIMATIONS === true;
  // The page-load secrets (night, Thursday, 42h) look once, on this load.
  if (!enabled) return;
  // Their toasts are worded at once: in the language of the settings.
  await initI18n();

  const start = () => {
    checkTimeAndDay();
    checkFortyTwoHours();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
