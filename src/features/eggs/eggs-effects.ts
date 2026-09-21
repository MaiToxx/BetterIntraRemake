/**
 * The visual effects of the easter eggs: confetti, party mode, the barrel
 * roll, the matrix rain and Maxwell. They are only wanted once a secret is
 * found, so they are a chunk of their own that eggs.ts loads on the first
 * one (see withEffects() there); the triggers, the toast and the records
 * stay in eggs.ts, on every page.
 */
import { html, render } from "lit-html";
import { tickWhileVisible } from "../../core/dom/dom-wait.ts";

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
      ${catSvg(() => host.classList.toggle("fast"))}`,
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
export function maxwellInvasion(seconds = 12, count = 48): void {
  const id = "ft-egg-maxwells";
  if (document.getElementById(id)) return;
  const host = document.createElement("div");
  host.id = id;
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
