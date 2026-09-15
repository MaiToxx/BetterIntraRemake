/**
 * Easter eggs. Eight small secrets hidden in the Intra, all local, all
 * harmless, all switched off together with the "Easter eggs" setting.
 *
 *   konami    ↑ ↑ ↓ ↓ ← → ← → B A          party mode (confetti + colours)
 *   barrel    type "barrel"                 the page does a barrel roll
 *   matrix    type "matrix"                 digital rain for a few seconds
 *   hacker    click the hub gear 7 times    unlocks the "🐇 Hacker" preset
 *   night     open the Intra between 2 and 5 am
 *   thursday  visit the dashboard on a Thursday (roulette day)
 *   fortytwo  a month at exactly 42h of logtime
 *   maxwell   type "maxwell"                a certain cat crosses the screen, spinning
 *
 * Every secret found is remembered in EGGS_FOUND (local only) and counted
 * in the About tab.
 */
import { html, render } from "lit-html";
import { getConfigMany } from "../../config.ts";
import { savePreset } from "../customize/presets.ts";
import { defaultCustomization } from "../customize/customize.ts";

export const EGG_IDS = [
  "konami",
  "barrel",
  "matrix",
  "hacker",
  "night",
  "thursday",
  "fortytwo",
  "maxwell",
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

const TOAST_ID = "ft-egg-toast";

export function toast(message: string, ms = 4500): void {
  let host = document.getElementById(TOAST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = TOAST_ID;
    (document.body || document.documentElement).appendChild(host);
  }
  render(
    html`<style>
        #${TOAST_ID} {
          position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
          z-index: 2147483000; padding: 10px 16px; border-radius: 999px;
          font: 500 14px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
          background: hsl(var(--card, 220 20% 10%)); color: hsl(var(--card-foreground, 0 0% 95%));
          border: 1px solid hsl(var(--primary, 181 100% 37%));
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
          animation: ft-egg-in 0.35s ease-out;
        }
        @keyframes ft-egg-in { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
      </style>
      <span>${message}</span>`,
    host,
  );
  const mine = host;
  setTimeout(() => {
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
  const timer = setInterval(() => {
    if (!canvas.isConnected) {
      clearInterval(timer);
      return;
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#00ff41";
    ctx.font = `${size}px monospace`;
    drops.forEach((y, i) => {
      const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
      ctx.fillText(ch, i * size, y * size);
      drops[i] = y * size > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
    });
  }, 45);
}

/**
 * Maxwell: a tuxedo cat (drawn here, no image download) that walks across
 * the bottom of the screen while spinning, as the meme demands. Click it
 * for a faster spin.
 */
export function maxwell(seconds = 9): void {
  const id = "ft-egg-maxwell";
  if (document.getElementById(id)) return;
  const host = document.createElement("div");
  host.id = id;
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
        @keyframes ft-mx-walk { from { left: -160px; } to { left: 100vw; } }
        @keyframes ft-mx-spin { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
        @media (prefers-reduced-motion: reduce) { #${id} svg { animation: none; } }
      </style>
      <svg viewBox="0 0 140 120" xmlns="http://www.w3.org/2000/svg" @click=${() => host.classList.toggle("fast")}>
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
        <ellipse cx="40" cy="45" rx="6" ry="7" fill="#7cff5b" />
        <ellipse cx="64" cy="45" rx="6" ry="7" fill="#7cff5b" />
        <ellipse cx="40" cy="45" rx="2" ry="6" fill="#111" />
        <ellipse cx="64" cy="45" rx="2" ry="6" fill="#111" />
        <path d="M48 55 l4 4 l4 -4 z" fill="#f4a7b9" />
        <path d="M52 59 v4 m0 0 q-4 5 -8 1 m8 -1 q4 5 8 1" stroke="#111" stroke-width="1.5" fill="none" />
        <path d="M20 52 l16 2 M20 60 l16 -2 M84 52 l-16 2 M84 60 l-16 -2" stroke="#ddd" stroke-width="1.2" />
      </svg>`,
    host,
  );
  (document.body || document.documentElement).appendChild(host);
  setTimeout(remove, seconds * 1000 + 200);
}

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

const TOTAL = EGG_IDS.length;

async function found(id: EggId, message: string): Promise<void> {
  const first = await recordEgg(id);
  const n = (await listFoundEggs()).length;
  toast(first ? `${message} · secret ${n}/${TOTAL} found` : message);
}

let gearClicks: number[] = [];

/** Called from the hub gear: seven clicks in four seconds unlock a preset. */
export async function gearClicked(): Promise<void> {
  const now = Date.now();
  gearClicks = gearClicks.filter((t) => now - t < 4000);
  gearClicks.push(now);
  if (gearClicks.length < 7) return;
  gearClicks = [];
  const { EASTER_EGGS_ENABLED } = await getConfigMany(["EASTER_EGGS_ENABLED"]);
  if (EASTER_EGGS_ENABLED === false) return;
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
  matrixRain(4);
  await found("hacker", "Wake up, Neo… the 🐇 Hacker preset is in Customize > Presets");
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function checkTimeAndDay(): void {
  const now = new Date();
  const h = now.getHours();
  const dayKey = now.toISOString().slice(0, 10);
  if (h >= 2 && h < 5 && localStorage.getItem("ft-egg-night") !== dayKey) {
    localStorage.setItem("ft-egg-night", dayKey);
    void found("night", `${h}h. The cluster never closes, but you could 😴`);
  }
  if (now.getDay() === 4 && location.pathname === "/") {
    let tries = 0;
    const timer = setInterval(() => {
      const title = document.querySelector<HTMLElement>('[data-ft-card="roulette"] [class*="uppercase"]');
      if (title && !title.dataset.ftEgg) {
        title.dataset.ftEgg = "1";
        title.textContent = `🎰 ${title.textContent ?? ""}`;
        clearInterval(timer);
        if (localStorage.getItem("ft-egg-thursday") !== dayKey) {
          localStorage.setItem("ft-egg-thursday", dayKey);
          void found("thursday", "It's roulette day. May the odds be ever in your favour 🎰");
        }
      }
      if (++tries > 30) clearInterval(timer);
    }, 500);
  }
}

/** Month badge of the logtime widget reading exactly "42h00". */
function checkFortyTwoHours(): void {
  if (location.pathname !== "/") return;
  let tries = 0;
  const timer = setInterval(() => {
    const root = document.getElementById("logtime-shadow-wrapper")?.shadowRoot;
    const badges = root ? Array.from(root.querySelectorAll(".badge")) : [];
    const hit = badges.some((b) => /^\s*42h00\b/.test(b.textContent ?? ""));
    if (hit) {
      clearInterval(timer);
      const monthKey = new Date().toISOString().slice(0, 7);
      if (localStorage.getItem("ft-egg-42") !== monthKey) {
        localStorage.setItem("ft-egg-42", monthKey);
        confetti();
        void found("fortytwo", "42h00 this month. The answer to everything ✨");
      }
    }
    if (++tries > 40) clearInterval(timer);
  }, 500);
}

let initialised = false;

export async function initEasterEggs(): Promise<void> {
  if (initialised) return;
  initialised = true;
  const { EASTER_EGGS_ENABLED } = await getConfigMany(["EASTER_EGGS_ENABLED"]);
  if (EASTER_EGGS_ENABLED === false) return;

  const feed = createSequenceMatcher(SEQUENCES, (id) => {
    if (id === "konami") {
      partyMode();
      void found("konami", "Party mode 🎉");
    } else if (id === "barrel") {
      barrelRoll();
      void found("barrel", "Do a barrel roll! 🛩️");
    } else if (id === "matrix") {
      matrixRain();
      void found("matrix", "There is no spoon 🥄");
    } else if (id === "maxwell") {
      maxwell();
      void found("maxwell", "Maxwell 🐈‍⬛ (click him to spin faster)");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    feed(e.key);
  });

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
