/**
 * Easter eggs. Nine small secrets hidden in the Intra, all local, all
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
 *   invasion  type it again while he is there  the screen fills with Maxwells
 *
 * Every secret found is remembered in EGGS_FOUND (local only) and counted
 * in the About tab.
 */
import { html, render } from "lit-html";
import { getConfigMany } from "../../core/config.ts";
import { waitForElement, watchDom } from "../../core/dom/dom-wait.ts";
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

/*
 * The effects themselves (confetti, party mode, barrel roll, matrix rain,
 * Maxwell) are in eggs-effects.ts, a chunk loaded the first time a secret
 * asks for one: most pages never find an egg. The wrappers below keep the
 * names and arguments they always had. The chunk may fail to load, for
 * example in a tab left open across an extension update: the secret is
 * still recorded and toasted, only the animation is skipped, and nothing is
 * thrown into the page.
 */
type EggEffects = typeof import("./eggs-effects.ts");

let effectsLoad: Promise<EggEffects | null> | null = null;

function withEffects(run: (effects: EggEffects) => void): Promise<void> {
  effectsLoad ??= import("./eggs-effects.ts").catch((err: unknown) => {
    console.warn("Better Intra: the easter egg effects could not be loaded.", err);
    effectsLoad = null;
    return null;
  });
  return effectsLoad.then((effects) => {
    if (effects) run(effects);
  });
}

export function confetti(): Promise<void> {
  return withEffects((e) => e.confetti());
}

export function partyMode(seconds?: number): Promise<void> {
  return withEffects((e) => e.partyMode(seconds));
}

export function barrelRoll(): Promise<void> {
  return withEffects((e) => e.barrelRoll());
}

export function matrixRain(seconds?: number): Promise<void> {
  return withEffects((e) => e.matrixRain(seconds));
}

export function maxwell(seconds?: number): Promise<void> {
  return withEffects((e) => e.maxwell(seconds));
}

export function maxwellInvasion(seconds?: number, count?: number): Promise<void> {
  return withEffects((e) => e.maxwellInvasion(seconds, count));
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
  // The presets module is shared with the hub, which loads it on demand too.
  let savePreset: typeof import("../customize/presets.ts").savePreset;
  try {
    ({ savePreset } = await import("../customize/presets.ts"));
  } catch (err) {
    console.warn("Better Intra: the hacker preset could not be loaded.", err);
    return;
  }
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
  void matrixRain(4);
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
    // Found on the mutation that adds the card instead of by a 500 ms poll.
    void waitForElement<HTMLElement>(ROULETTE_TITLE, {
      timeoutMs: THURSDAY_WAIT_MS,
    }).then((title) => {
      if (!title || title.dataset.ftEgg) return;
      title.dataset.ftEgg = "1";
      title.textContent = `🎰 ${title.textContent ?? ""}`;
      if (localStorage.getItem("ft-egg-thursday") !== dayKey) {
        localStorage.setItem("ft-egg-thursday", dayKey);
        void found("thursday", "It's roulette day. May the odds be ever in your favour 🎰");
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
    const monthKey = new Date().toISOString().slice(0, 7);
    if (localStorage.getItem("ft-egg-42") !== monthKey) {
      localStorage.setItem("ft-egg-42", monthKey);
      void confetti();
      void found("fortytwo", "42h00 this month. The answer to everything ✨");
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

export async function initEasterEggs(): Promise<void> {
  if (initialised) return;
  initialised = true;
  const { EASTER_EGGS_ENABLED } = await getConfigMany(["EASTER_EGGS_ENABLED"]);
  if (EASTER_EGGS_ENABLED === false) return;

  const feed = createSequenceMatcher(SEQUENCES, (id) => {
    if (id === "konami") {
      void partyMode();
      void found("konami", "Party mode 🎉");
    } else if (id === "barrel") {
      void barrelRoll();
      void found("barrel", "Do a barrel roll! 🛩️");
    } else if (id === "matrix") {
      void matrixRain();
      void found("matrix", "There is no spoon 🥄");
    } else if (id === "maxwell") {
      if (document.getElementById("ft-egg-maxwell")) {
        void maxwellInvasion();
        void found("invasion", "FULL MAXWELL 🐈‍⬛🐈‍⬛🐈‍⬛");
      } else {
        void maxwell();
        void found("maxwell", "Maxwell 🐈‍⬛ (click him to spin faster, type his name again for more)");
      }
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
