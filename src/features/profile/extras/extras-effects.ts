/**
 * Particle effects of the public profile extras (snow, stars, fireflies…),
 * drawn on ONE canvas fixed over the page. The canvas never takes pointer
 * events and sits under the Intra's dialogs (z-index 40).
 *
 * The effect, its intensity and its tint are chosen by the owner of the
 * profile, i.e. by a stranger: the effect and the intensity are looked up in
 * the enums of the contract, the tint is a strict #rrggbb or nothing, and
 * none of them ever reaches the DOM or a stylesheet: they only select
 * constants and end up in canvas fillStyle / strokeStyle.
 *
 * The simulation (createParticle / stepParticle) is pure and takes its random
 * source as an argument so that tests are deterministic. The running part
 * (startEffect / stopEffect) owns the canvas, the animation frame and the
 * resize listener, and allocates nothing per frame: a particle that leaves
 * the viewport is respawned in place.
 */
import {
  EFFECTS,
  EXTRAS_EFFECT_ID,
  INTENSITIES,
  type Effect,
  type Intensity,
} from "./extras.ts";

export interface Particle {
  x: number;
  y: number;
  /** Velocity, px per second. */
  vx: number;
  vy: number;
  /** Radius (dots, bubbles), width (confetti), long radius (petals) or streak length (rain), px. */
  size: number;
  /** Base opacity; twinkle, pulse and fade are derived from phase / life when drawing. */
  alpha: number;
  /** Oscillator behind the sway, twinkle, pulse and flip, radians. */
  phase: number;
  /** Orientation of confetti and petals, radians. */
  rot: number;
  /** Angular speed, rad/s: turns `rot` and paces `phase` (turn rate of the heading for fireflies). */
  vr: number;
  /** #rrggbb taken from the palette of the effect (a tint overrides it at draw time). */
  color: string;
  /** Remaining life in ms; Infinity when only leaving the viewport ends it. */
  life: number;
}

const TAU = Math.PI * 2;

/** Particle counts for a 1920x1080 viewport. */
const BASE_COUNT: Record<Intensity, number> = { low: 30, medium: 60, high: 110 };
const REFERENCE_AREA = 1920 * 1080;
const MIN_COUNT = 10;
const MAX_COUNT = 160;

/** shadowBlur is by far the most expensive thing drawn here: only these use it, with half the particles. */
const GLOW_BLUR: Partial<Record<Effect, number>> = { fireflies: 12, embers: 8 };

/** A particle is gone once it is further than this outside the viewport (edge spawns stay within it). */
const MARGIN = 40;
/** Longest step of the simulation: a tab coming back from the background must not teleport everything. */
const MAX_DT_MS = 50;
/**
 * Shortest time between two drawn frames. A 60 Hz screen (16.7 ms) draws every
 * frame; 120-240 Hz screens skip frames and land around 50-60 fps, which is
 * plenty for ambient particles and divides their cost by two to four.
 */
const MIN_FRAME_MS = 14;
/** Retina canvases quadruple the fill cost for particles nobody looks at closely. */
const MAX_DPR = 1.5;
const RESIZE_DEBOUNCE_MS = 150;

/** Rain falls along one direction so that the streaks stay parallel (and can be batched in one path). */
const RAIN_SLANT = 0.15;
const RAIN_DX = -RAIN_SLANT / Math.hypot(1, RAIN_SLANT);
const RAIN_DY = 1 / Math.hypot(1, RAIN_SLANT);
const RAIN_ALPHA = 0.5;
const EMBER_FADE_MS = 1200;

const PALETTES: Record<Effect, readonly string[]> = {
  none: ["#ffffff"],
  snow: ["#ffffff", "#eaf4ff", "#d5e6fb"],
  stars: ["#ffffff", "#fff4d6", "#d6e6ff"],
  fireflies: ["#e8ff7a", "#c8f65a", "#fff59a"],
  confetti: ["#00babc", "#ff5f56", "#ffbd2e", "#27c93f", "#7c3aed", "#ff7ac6"],
  bubbles: ["#ffffff", "#bfe9ff", "#8fd3ff"],
  sakura: ["#ffc0d9", "#ffa6c9", "#ff8fb8", "#ffd9e8"],
  rain: ["#a8c7e8", "#c9def2", "#8fb3d9"],
  embers: ["#ff9a3c", "#ff6a1a", "#ffc46b", "#ff4d00"],
};

/* ------------------------------------------------------------------ */
/* Simulation (pure)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Number of particles for a viewport: proportional to its area so that the
 * density looks the same on a laptop and on a 4K screen, within hard bounds
 * (a huge screen must not cost more than MAX_COUNT particles).
 */
export function particleCount(intensity: Intensity, width: number, height: number): number {
  const base = BASE_COUNT[intensity] ?? BASE_COUNT.medium;
  const n = Math.round((base * Math.max(0, width) * Math.max(0, height)) / REFERENCE_AREA);
  if (!Number.isFinite(n)) return MIN_COUNT;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, n));
}

/** particleCount(), halved for the effects that pay for a shadowBlur. */
export function effectParticleCount(
  effect: Effect,
  intensity: Intensity,
  width: number,
  height: number,
): number {
  const n = particleCount(intensity, width, height);
  return GLOW_BLUR[effect] ? Math.ceil(n / 2) : n;
}

function pick(list: readonly string[], rand: () => number): string {
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

/** (Re)initialise `p` in place: respawning must not allocate. */
function spawn(
  p: Particle,
  effect: Effect,
  w: number,
  h: number,
  rand: () => number,
  atEdge: boolean,
): Particle {
  p.x = rand() * w;
  p.y = rand() * h;
  p.vx = 0;
  p.vy = 0;
  p.size = 1;
  p.alpha = 1;
  p.phase = rand() * TAU;
  p.rot = 0;
  p.vr = 0;
  p.color = pick(PALETTES[effect] ?? PALETTES.none, rand);
  p.life = Infinity;

  switch (effect) {
    case "snow":
      p.size = 1 + rand() * 2.5;
      // big flakes look closer: they fall faster
      p.vy = 20 + p.size * 14 + rand() * 10;
      p.vx = (rand() - 0.5) * 20;
      p.alpha = 0.4 + rand() * 0.5;
      p.vr = 0.5 + rand();
      if (atEdge) p.y = -p.size;
      break;
    case "stars":
      p.size = 0.6 + rand() * 1.4;
      // the whole sky drifts the same way, like a slow rotation
      p.vx = 2 + rand() * 5;
      p.vy = (rand() - 0.5) * 2;
      p.alpha = 0.5 + rand() * 0.5;
      p.vr = 0.8 + rand() * 2.2;
      if (atEdge) p.x = -p.size;
      break;
    case "fireflies": {
      p.size = 1.8 + rand() * 1.4;
      p.alpha = 0.65 + rand() * 0.35;
      p.vr = (rand() - 0.5) * 3;
      const speed = 12 + rand() * 23;
      let heading = rand() * TAU;
      if (atEdge) {
        // any side, heading inwards (+-45deg) so that it does not leave at once
        const edge = Math.min(3, Math.floor(rand() * 4));
        const spread = (rand() - 0.5) * (Math.PI / 2);
        if (edge === 0) {
          p.y = -p.size;
          heading = Math.PI / 2 + spread;
        } else if (edge === 1) {
          p.x = w + p.size;
          heading = Math.PI + spread;
        } else if (edge === 2) {
          p.y = h + p.size;
          heading = -Math.PI / 2 + spread;
        } else {
          p.x = -p.size;
          heading = spread;
        }
      }
      p.vx = Math.cos(heading) * speed;
      p.vy = Math.sin(heading) * speed;
      break;
    }
    case "confetti":
      p.size = 5 + rand() * 5;
      p.vy = 40 + rand() * 50;
      p.vx = (rand() - 0.5) * 30;
      p.alpha = 0.75 + rand() * 0.25;
      p.rot = rand() * TAU;
      p.vr = (1 + rand() * 3) * (rand() < 0.5 ? -1 : 1);
      if (atEdge) p.y = -p.size;
      break;
    case "bubbles":
      p.size = 3 + rand() * 9;
      p.vy = -(20 + p.size * 4 + rand() * 15);
      p.vx = (rand() - 0.5) * 10;
      p.alpha = 0.25 + rand() * 0.35;
      p.vr = 0.8 + rand() * 1.2;
      if (atEdge) p.y = h + p.size;
      break;
    case "sakura":
      p.size = 4 + rand() * 4;
      p.vx = 25 + rand() * 35;
      p.vy = 30 + rand() * 30;
      p.alpha = 0.6 + rand() * 0.35;
      p.rot = rand() * TAU;
      p.vr = (0.6 + rand() * 1.2) * (rand() < 0.5 ? -1 : 1);
      if (atEdge) {
        // petals travel down and to the right: they come in from the top and from the left
        if (rand() * (w + h) < w) p.y = -p.size;
        else p.x = -p.size;
      }
      break;
    case "rain":
      p.size = 10 + rand() * 14;
      p.vy = 700 + rand() * 400;
      p.vx = -p.vy * RAIN_SLANT;
      p.alpha = RAIN_ALPHA;
      if (atEdge) {
        // start further right than the viewport, or the slant would leave its bottom right corner dry
        p.x = rand() * (w + h * RAIN_SLANT);
        p.y = -p.size;
      }
      break;
    case "embers":
      p.size = 1 + rand() * 1.6;
      p.vy = -(40 + rand() * 70);
      p.vx = (rand() - 0.5) * 30;
      p.alpha = 0.7 + rand() * 0.3;
      p.vr = 2 + rand() * 2;
      p.life = 2500 + rand() * 2500;
      if (atEdge) {
        p.y = h + p.size;
      } else {
        // first fill: sparks already on their way up, part of their life behind them
        p.y = h * (0.4 + 0.6 * rand());
        p.life *= 0.3 + 0.7 * rand();
      }
      break;
    default:
      break;
  }
  return p;
}

/**
 * New particle of `effect` in a w x h viewport: anywhere inside it (first
 * fill), or just outside the edge it enters from when `spawnAtEdge` is set.
 */
export function createParticle(
  effect: Effect,
  w: number,
  h: number,
  rand: () => number,
  spawnAtEdge = false,
): Particle {
  const blank: Particle = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 1,
    alpha: 1,
    phase: 0,
    rot: 0,
    vr: 0,
    color: "#ffffff",
    life: Infinity,
  };
  return spawn(blank, effect, w, h, rand, spawnAtEdge);
}

/**
 * Out of the margin AND not coming back: rain and petals spawn beyond the
 * margin on purpose and travel towards the viewport. The second bound ends
 * anything that is absurdly far, whatever its direction.
 */
function hasLeft(p: Particle, w: number, h: number): boolean {
  const far = MARGIN + Math.max(w, h) * 0.5;
  return (
    (p.x < -MARGIN && (p.vx <= 0 || p.x < -far)) ||
    (p.x > w + MARGIN && (p.vx >= 0 || p.x > w + far)) ||
    (p.y < -MARGIN && (p.vy <= 0 || p.y < -far)) ||
    (p.y > h + MARGIN && (p.vy >= 0 || p.y > h + far))
  );
}

/**
 * Advance `p` by `dt` milliseconds (mutates and returns it). A particle that
 * left the viewport, or whose life ended, is respawned in place at the edge it
 * enters from; it keeps its colour so that the particles stay grouped by
 * colour for drawing (see the fillStyle batching in the draw functions).
 */
export function stepParticle(
  p: Particle,
  effect: Effect,
  w: number,
  h: number,
  dt: number,
  rand: () => number,
): Particle {
  const s = dt / 1000;
  let sway = 0;
  switch (effect) {
    case "snow":
      sway = 14;
      break;
    case "confetti":
      sway = 20;
      break;
    case "bubbles":
      sway = 10;
      break;
    case "sakura":
      sway = 25;
      break;
    default:
      break;
  }

  if (effect === "fireflies") {
    // wander: the velocity turns at `vr`, which changes now and then (about every 1.2 s)
    if (rand() < s * 0.8) p.vr = (rand() - 0.5) * 3;
    const a = p.vr * s;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const vx = p.vx * cos - p.vy * sin;
    p.vy = p.vx * sin + p.vy * cos;
    p.vx = vx;
    p.phase += (1.2 + p.size * 0.3) * s;
  } else {
    p.phase += Math.abs(p.vr) * s;
    p.rot += p.vr * s;
  }

  p.x += p.vx * s;
  p.y += p.vy * s;
  if (sway) p.x += Math.sin(p.phase) * sway * s;
  if (effect === "sakura") p.y += Math.cos(p.phase) * 8 * s;
  if (effect === "embers") p.x += Math.sin(p.phase * 0.5) * 20 * s;

  p.life -= dt;
  if (p.life <= 0 || hasLeft(p, w, h)) {
    const color = p.color;
    spawn(p, effect, w, h, rand, true);
    p.color = color;
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function byColor(a: Particle, b: Particle): number {
  return a.color < b.color ? -1 : a.color > b.color ? 1 : 0;
}

function dotAlpha(p: Particle, effect: Effect): number {
  switch (effect) {
    case "stars":
      return p.alpha * (0.3 + 0.35 * (1 + Math.sin(p.phase)));
    case "fireflies": {
      // mostly dark, with a slow flash
      const s = Math.sin(p.phase);
      return p.alpha * (s > 0 ? 0.2 + 0.8 * s : 0.2);
    }
    case "embers":
      return (
        p.alpha *
        Math.min(1, Math.max(0, p.life / EMBER_FADE_MS)) *
        (0.8 + 0.2 * Math.sin(p.phase * 4))
      );
    default:
      return p.alpha;
  }
}

/**
 * Snow, stars, fireflies and embers: filled circles. The particles are sorted
 * by colour, so fillStyle (and shadowColor) change a handful of times per
 * frame, once with a tint.
 */
function drawDots(
  ctx: CanvasRenderingContext2D,
  ps: Particle[],
  tint: string,
  effect: Effect,
): void {
  const blur = GLOW_BLUR[effect] ?? 0;
  ctx.shadowBlur = blur;
  let last = "";
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const color = tint || p.color;
    if (color !== last) {
      ctx.fillStyle = color;
      if (blur) ctx.shadowColor = color;
      last = color;
    }
    ctx.globalAlpha = dotAlpha(p, effect);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, TAU);
    ctx.fill();
    if (effect === "stars" && p.size > 1.4) {
      // the brightest stars get a small four-point sparkle
      const arm = p.size * 3;
      ctx.fillRect(p.x - arm, p.y - 0.3, arm * 2, 0.6);
      ctx.fillRect(p.x - 0.3, p.y - arm, 0.6, arm * 2);
    }
  }
  ctx.shadowBlur = 0;
}

function drawConfetti(
  ctx: CanvasRenderingContext2D,
  ps: Particle[],
  tint: string,
  dpr: number,
): void {
  let last = "";
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const color = tint || p.color;
    if (color !== last) {
      ctx.fillStyle = color;
      last = color;
    }
    ctx.globalAlpha = p.alpha;
    // setTransform instead of save / translate / rotate / restore: one call per piece
    const cos = Math.cos(p.rot) * dpr;
    const sin = Math.sin(p.rot) * dpr;
    ctx.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
    // the height follows the phase: the piece seems to flip as it falls
    const height = p.size * 0.5 * Math.cos(p.phase);
    ctx.fillRect(-p.size / 2, -height / 2, p.size, height);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawBubbles(ctx: CanvasRenderingContext2D, ps: Particle[], tint: string): void {
  ctx.lineWidth = 1;
  let last = "";
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const color = tint || p.color;
    if (color !== last) {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      last = color;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, TAU);
    ctx.globalAlpha = p.alpha * 0.18;
    ctx.fill();
    ctx.globalAlpha = p.alpha;
    ctx.stroke();
    // reflection
    ctx.beginPath();
    ctx.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.2, 0, TAU);
    ctx.fill();
  }
}

function drawSakura(ctx: CanvasRenderingContext2D, ps: Particle[], tint: string): void {
  let last = "";
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const color = tint || p.color;
    if (color !== last) {
      ctx.fillStyle = color;
      last = color;
    }
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    // the short radius breathes with the phase: the petal tumbles
    const short = p.size * (0.3 + 0.3 * Math.abs(Math.cos(p.phase)));
    ctx.ellipse(p.x, p.y, p.size, short, p.rot, 0, TAU);
    ctx.fill();
  }
}

/** One path and one stroke per colour (the particles are sorted by colour). */
function drawRain(ctx: CanvasRenderingContext2D, ps: Particle[], tint: string): void {
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = RAIN_ALPHA;
  let last = "";
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const color = tint || p.color;
    if (color !== last) {
      if (last) ctx.stroke();
      ctx.strokeStyle = color;
      ctx.beginPath();
      last = color;
    }
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - RAIN_DX * p.size, p.y - RAIN_DY * p.size);
  }
  if (last) ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* Running effect                                                      */
/* ------------------------------------------------------------------ */

interface Running {
  /** effect|intensity|tint, to recognise a repeated startEffect(). */
  key: string;
  effect: Effect;
  intensity: Intensity;
  tint: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  particles: Particle[];
  w: number;
  h: number;
  dpr: number;
  raf: number;
  /** Timestamp of the previous frame; negative before the first one. */
  last: number;
  resizeTimer: ReturnType<typeof setTimeout> | undefined;
}

let running: Running | null = null;

function prefersReducedMotion(): boolean {
  try {
    // jsdom (tests) has no matchMedia
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/** Size the bitmap for the viewport. Assigning width / height also resets the context state. */
function fitCanvas(r: Running): void {
  const ratio = window.devicePixelRatio;
  r.dpr = ratio > 0 ? Math.min(ratio, MAX_DPR) : 1;
  r.w = Math.max(0, window.innerWidth || 0);
  r.h = Math.max(0, window.innerHeight || 0);
  r.canvas.width = Math.round(r.w * r.dpr);
  r.canvas.height = Math.round(r.h * r.dpr);
}

function applyResize(): void {
  const r = running;
  if (!r) return;
  r.resizeTimer = undefined;
  const oldW = r.w;
  const oldH = r.h;
  fitCanvas(r);
  const ps = r.particles;
  // keep the particles spread over the new viewport instead of waiting for them to drift there
  const sx = oldW > 0 ? r.w / oldW : 1;
  const sy = oldH > 0 ? r.h / oldH : 1;
  for (let i = 0; i < ps.length; i++) {
    ps[i].x *= sx;
    ps[i].y *= sy;
  }
  const n = effectParticleCount(r.effect, r.intensity, r.w, r.h);
  if (n < ps.length) {
    ps.length = n;
  } else if (n > ps.length) {
    while (ps.length < n) ps.push(createParticle(r.effect, r.w, r.h, Math.random));
    ps.sort(byColor);
  }
}

function onResize(): void {
  const r = running;
  if (!r) return;
  clearTimeout(r.resizeTimer);
  r.resizeTimer = setTimeout(applyResize, RESIZE_DEBOUNCE_MS);
}

function frame(now: number): void {
  const r = running;
  if (!r) return;
  if (!r.canvas.isConnected) {
    // the page replaced <body>'s content: do not keep animating a detached canvas
    stopEffect();
    return;
  }
  r.raf = requestAnimationFrame(frame);
  const elapsed = r.last < 0 ? 0 : Math.max(0, now - r.last);
  if (r.last >= 0 && elapsed < MIN_FRAME_MS) return;
  const dt = Math.min(MAX_DT_MS, elapsed);
  r.last = now;
  if (document.hidden) return;

  const { ctx, particles: ps, effect, tint } = r;
  for (let i = 0; i < ps.length; i++) {
    stepParticle(ps[i], effect, r.w, r.h, dt, Math.random);
  }

  ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
  ctx.clearRect(0, 0, r.w, r.h);
  switch (effect) {
    case "confetti":
      drawConfetti(ctx, ps, tint, r.dpr);
      break;
    case "bubbles":
      drawBubbles(ctx, ps, tint);
      break;
    case "sakura":
      drawSakura(ctx, ps, tint);
      break;
    case "rain":
      drawRain(ctx, ps, tint);
      break;
    default:
      drawDots(ctx, ps, tint, effect);
      break;
  }
}

/**
 * Start (or replace) the effect. Nothing happens when the very same effect is
 * already running, so callers can re-apply a profile as often as they like.
 * "none", an unknown effect and visitors who prefer reduced motion get no
 * canvas at all (and whatever was running is stopped).
 */
export function startEffect(effect: Effect, intensity: Intensity, tint: string): void {
  if (!EFFECTS.includes(effect) || effect === "none" || prefersReducedMotion()) {
    stopEffect();
    return;
  }
  const level: Intensity = INTENSITIES.includes(intensity) ? intensity : "medium";
  const color = typeof tint === "string" && /^#[0-9a-f]{6}$/i.test(tint) ? tint.toLowerCase() : "";
  const key = `${effect}|${level}|${color}`;
  if (running && running.key === key && running.canvas.isConnected) return;
  stopEffect();

  const canvas = document.createElement("canvas");
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) {
    // no 2d context (jsdom, exotic browsers): no effect, and nothing left behind
    canvas.remove();
    return;
  }
  canvas.id = EXTRAS_EFFECT_ID;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:40;";

  const r: Running = {
    key,
    effect,
    intensity: level,
    tint: color,
    canvas,
    ctx,
    particles: [],
    w: 0,
    h: 0,
    dpr: 1,
    raf: 0,
    last: -1,
    resizeTimer: undefined,
  };
  fitCanvas(r);
  const n = effectParticleCount(effect, level, r.w, r.h);
  for (let i = 0; i < n; i++) r.particles.push(createParticle(effect, r.w, r.h, Math.random));
  r.particles.sort(byColor);

  (document.body || document.documentElement).appendChild(canvas);
  window.addEventListener("resize", onResize, { passive: true });
  running = r;
  r.raf = requestAnimationFrame(frame);
}

/** Stop the effect and remove its canvas. Safe to call when nothing runs. */
export function stopEffect(): void {
  const r = running;
  running = null;
  if (r) {
    cancelAnimationFrame(r.raf);
    clearTimeout(r.resizeTimer);
    window.removeEventListener("resize", onResize);
    r.canvas.remove();
  }
  // a canvas left by a previous instance of the content script (extension reloaded)
  document.getElementById(EXTRAS_EFFECT_ID)?.remove();
}

export function isEffectRunning(): boolean {
  return running !== null;
}
