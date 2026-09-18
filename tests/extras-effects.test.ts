import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EFFECTS,
  EXTRAS_EFFECT_ID,
  INTENSITIES,
  type Effect,
} from "../src/features/profile/extras/extras";
import {
  createParticle,
  effectParticleCount,
  isEffectRunning,
  particleCount,
  startEffect,
  stepParticle,
  stopEffect,
  type Particle,
} from "../src/features/profile/extras/extras-effects";

const W = 1280;
const H = 720;
const ACTIVE = EFFECTS.filter((e) => e !== "none") as Exclude<Effect, "none">[];

/** mulberry32: a small seeded generator, so that every run sees the same particles. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Is `p` where a particle of `effect` enters the viewport, moving inwards? */
function atEnteringEdge(p: Particle, effect: Effect): boolean {
  const insideX = p.x >= 0 && p.x <= W;
  const insideY = p.y >= 0 && p.y <= H;
  const top = p.y <= 0 && p.y >= -40 && p.vy > 0;
  const bottom = p.y >= H && p.y <= H + 40 && p.vy < 0;
  const left = p.x <= 0 && p.x >= -40 && p.vx > 0;
  const right = p.x >= W && p.x <= W + 40 && p.vx < 0;
  switch (effect) {
    case "snow":
    case "confetti":
      return top && insideX;
    case "rain":
      // starts up to slant * height further right, heading left
      return top && p.x >= 0 && p.x <= W + H * 0.15 + 1 && p.vx < 0;
    case "bubbles":
    case "embers":
      return bottom && insideX;
    case "stars":
      return left && insideY;
    case "sakura":
      return (top && insideX) || (left && insideY);
    case "fireflies":
      return (top && insideX) || (bottom && insideX) || (left && insideY) || (right && insideY);
    default:
      return false;
  }
}

describe("particleCount", () => {
  it("uses the base counts on a 1920x1080 viewport", () => {
    expect(particleCount("low", 1920, 1080)).toBe(30);
    expect(particleCount("medium", 1920, 1080)).toBe(60);
    expect(particleCount("high", 1920, 1080)).toBe(110);
  });

  it("grows with the intensity and with the viewport area", () => {
    for (const [w, h] of [[800, 600], [1366, 768], [1920, 1080], [2560, 1440]]) {
      const [low, medium, high] = INTENSITIES.map((i) => particleCount(i, w, h));
      expect(low).toBeLessThanOrEqual(medium);
      expect(medium).toBeLessThanOrEqual(high);
    }
    expect(particleCount("high", 1366, 768)).toBeLessThan(particleCount("high", 1920, 1080));
    expect(particleCount("low", 1920, 1080)).toBeLessThan(particleCount("high", 1920, 1080));
  });

  it("is clamped to [10, 160]", () => {
    expect(particleCount("low", 100, 100)).toBe(10);
    expect(particleCount("high", 0, 0)).toBe(10);
    expect(particleCount("high", -500, 900)).toBe(10);
    expect(particleCount("medium", NaN, 900)).toBe(10);
    expect(particleCount("low", 10000, 10000)).toBe(160);
    expect(particleCount("high", Infinity, Infinity)).toBe(10);
    // a value that did not come through the sanitizer falls back to medium
    expect(particleCount("extreme" as any, 1920, 1080)).toBe(60);
  });

  it("halves the effects that pay for a glow", () => {
    expect(effectParticleCount("snow", "high", 1920, 1080)).toBe(110);
    expect(effectParticleCount("fireflies", "high", 1920, 1080)).toBe(55);
    expect(effectParticleCount("embers", "high", 1920, 1080)).toBe(55);
    expect(effectParticleCount("embers", "low", 100, 100)).toBe(5);
  });
});

describe("createParticle", () => {
  it("places the first particles inside the viewport, for every effect", () => {
    for (const effect of ACTIVE) {
      const rand = seeded(42);
      for (let i = 0; i < 200; i++) {
        const p = createParticle(effect, W, H, rand);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(W);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(H);
        expect(p.size).toBeGreaterThan(0);
        expect(p.alpha).toBeGreaterThan(0);
        expect(p.alpha).toBeLessThanOrEqual(1);
        expect(p.life).toBeGreaterThan(0);
        expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
        for (const n of [p.x, p.y, p.vx, p.vy, p.size, p.alpha, p.phase, p.rot, p.vr]) {
          expect(Number.isFinite(n)).toBe(true);
        }
      }
    }
  });

  it("spawns at the edge the effect enters from, moving inwards", () => {
    for (const effect of ACTIVE) {
      const rand = seeded(7);
      for (let i = 0; i < 200; i++) {
        const p = createParticle(effect, W, H, rand, true);
        expect(atEnteringEdge(p, effect), `${effect} ${JSON.stringify(p)}`).toBe(true);
      }
    }
  });

  it("is deterministic for a given random source", () => {
    for (const effect of ACTIVE) {
      expect(createParticle(effect, W, H, seeded(3))).toEqual(createParticle(effect, W, H, seeded(3)));
      expect(createParticle(effect, W, H, seeded(3), true)).toEqual(
        createParticle(effect, W, H, seeded(3), true),
      );
    }
  });

  it("survives extreme random values", () => {
    for (const effect of ACTIVE) {
      for (const value of [0, 0.999999999]) {
        const p = createParticle(effect, W, H, () => value, true);
        expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(Number.isFinite(p.x + p.y + p.vx + p.vy)).toBe(true);
      }
    }
  });
});

describe("stepParticle", () => {
  /** A particle in the middle of the viewport: one step cannot take it out. */
  function centred(effect: Effect, rand: () => number): Particle {
    const p = createParticle(effect, W, H, rand);
    p.x = W / 2;
    p.y = H / 2;
    return p;
  }

  it("mutates and returns the particle", () => {
    const rand = seeded(1);
    const p = centred("snow", rand);
    expect(stepParticle(p, "snow", W, H, 16, rand)).toBe(p);
  });

  it("moves snow, confetti, sakura and rain down, bubbles and embers up", () => {
    for (const effect of ["snow", "confetti", "sakura", "rain"] as const) {
      const rand = seeded(11);
      for (let i = 0; i < 50; i++) {
        const p = centred(effect, rand);
        stepParticle(p, effect, W, H, 16, rand);
        expect(p.y, effect).toBeGreaterThan(H / 2);
      }
    }
    for (const effect of ["bubbles", "embers"] as const) {
      const rand = seeded(12);
      for (let i = 0; i < 50; i++) {
        const p = centred(effect, rand);
        stepParticle(p, effect, W, H, 16, rand);
        expect(p.y, effect).toBeLessThan(H / 2);
      }
    }
  });

  it("drifts stars slowly and keeps fireflies at their speed while they wander", () => {
    const rand = seeded(13);
    const star = centred("stars", rand);
    stepParticle(star, "stars", W, H, 1000, rand);
    expect(star.x - W / 2).toBeGreaterThan(0);
    expect(star.x - W / 2).toBeLessThan(10);

    const fly = centred("fireflies", rand);
    const speed = Math.hypot(fly.vx, fly.vy);
    const heading = Math.atan2(fly.vy, fly.vx);
    for (let i = 0; i < 20; i++) stepParticle(fly, "fireflies", 1e6, 1e6, 16, rand);
    expect(Math.hypot(fly.vx, fly.vy)).toBeCloseTo(speed, 6);
    expect(Math.atan2(fly.vy, fly.vx)).not.toBeCloseTo(heading, 6);
  });

  it("makes rain fast", () => {
    const rand = seeded(14);
    const rain = centred("rain", rand);
    const snow = centred("snow", rand);
    stepParticle(rain, "rain", W, H, 16, rand);
    stepParticle(snow, "snow", W, H, 16, rand);
    const rainFall = rain.y - H / 2;
    const snowFall = snow.y - H / 2;
    expect(rainFall).toBeGreaterThan(10); // > 600 px/s
    expect(rainFall).toBeGreaterThan(snowFall * 8);
    expect(rain.x).toBeLessThan(W / 2); // slanted
  });

  it("does not move when no time passed", () => {
    const rand = seeded(15);
    for (const effect of ACTIVE) {
      const p = centred(effect, rand);
      stepParticle(p, effect, W, H, 0, rand);
      expect(p.x).toBe(W / 2);
      expect(p.y).toBe(H / 2);
    }
  });

  it("respawns a particle pushed far outside, at its entering edge, with its colour", () => {
    const far: [number, number][] = [
      [W * 10, H * 10],
      [-W * 10, -H * 10],
      [W / 2, H * 10],
      [W / 2, -H * 10],
    ];
    for (const effect of ACTIVE) {
      for (const [x, y] of far) {
        const rand = seeded(21);
        const p = createParticle(effect, W, H, rand);
        const color = p.color;
        p.x = x;
        p.y = y;
        expect(stepParticle(p, effect, W, H, 16, rand)).toBe(p);
        expect(atEnteringEdge(p, effect), `${effect} from ${x},${y}`).toBe(true);
        expect(p.color).toBe(color);
      }
    }
  });

  it("keeps a particle that spawned beyond the margin but travels towards the viewport", () => {
    const rand = seeded(22);
    const p = createParticle("rain", W, H, rand, true);
    p.x = W + 90; // further than the margin, heading left
    stepParticle(p, "rain", W, H, 16, rand);
    expect(p.x).toBeGreaterThan(W);
    expect(p.y).toBeGreaterThan(0);
  });

  it("respawns an ember at the bottom when its life ends", () => {
    const rand = seeded(23);
    const p = createParticle("embers", W, H, rand);
    p.x = W / 2;
    p.y = H / 2;
    p.life = 10;
    stepParticle(p, "embers", W, H, 16, rand);
    expect(p.y).toBeGreaterThanOrEqual(H);
    expect(p.life).toBeGreaterThan(1000);
  });

  it("keeps every effect in or around the viewport over a long run", () => {
    for (const effect of ACTIVE) {
      const rand = seeded(31);
      const ps = Array.from({ length: 20 }, () => createParticle(effect, W, H, rand));
      for (let frame = 0; frame < 1500; frame++) {
        for (const p of ps) stepParticle(p, effect, W, H, 50, rand);
      }
      for (const p of ps) {
        expect(p.x, effect).toBeGreaterThan(-W);
        expect(p.x, effect).toBeLessThan(2 * W);
        expect(p.y, effect).toBeGreaterThan(-H);
        expect(p.y, effect).toBeLessThan(2 * H);
      }
    }
  });
});

describe("startEffect / stopEffect", () => {
  const METHODS = [
    "setTransform",
    "clearRect",
    "beginPath",
    "arc",
    "ellipse",
    "fill",
    "stroke",
    "fillRect",
    "moveTo",
    "lineTo",
  ] as const;
  type FakeContext = Record<(typeof METHODS)[number], ReturnType<typeof vi.fn>> &
    Record<string, unknown>;

  /** Minimal 2d context: the methods the module calls, as spies; properties are plain assignments. */
  function fakeContext(): FakeContext {
    const ctx: Record<string, unknown> = {};
    for (const name of METHODS) ctx[name] = vi.fn();
    return ctx as FakeContext;
  }

  function stubContext(): FakeContext {
    const ctx = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as any);
    return ctx;
  }

  /** Take over requestAnimationFrame: frames only run when the test says so. */
  function stubFrames(): { run: (now: number) => void; pending: () => number; cancel: ReturnType<typeof vi.fn> } {
    let queue: FrameRequestCallback[] = [];
    const cancel = vi.fn(() => {
      queue = [];
    });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", cancel);
    return {
      run(now) {
        const callbacks = queue;
        queue = [];
        for (const cb of callbacks) cb(now);
      },
      pending: () => queue.length,
      cancel,
    };
  }

  const canvases = () => document.querySelectorAll(`#${EXTRAS_EFFECT_ID}`);

  afterEach(() => {
    stopEffect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as any).matchMedia;
    delete (document as any).hidden;
    document.body.replaceChildren();
  });

  it("creates nothing for \"none\" or an unknown effect", () => {
    const ctx = stubContext();
    startEffect("none", "medium", "");
    startEffect("lasers" as any, "medium", "");
    expect(canvases().length).toBe(0);
    expect(document.querySelector("canvas")).toBeNull();
    expect(isEffectRunning()).toBe(false);
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it("leaves no canvas behind when there is no 2d context", () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(() => startEffect("snow", "medium", "")).not.toThrow();
    expect(spy).toHaveBeenCalledWith("2d");
    expect(document.querySelector("canvas")).toBeNull();
    expect(isEffectRunning()).toBe(false);

    spy.mockImplementation(() => {
      throw new Error("not implemented");
    });
    expect(() => startEffect("rain", "high", "#336699")).not.toThrow();
    expect(document.querySelector("canvas")).toBeNull();
    expect(isEffectRunning()).toBe(false);
  });

  it("runs on one fixed canvas that ignores the pointer", () => {
    stubContext();
    stubFrames();
    startEffect("snow", "medium", "");
    expect(isEffectRunning()).toBe(true);
    expect(canvases().length).toBe(1);
    const canvas = document.getElementById(EXTRAS_EFFECT_ID) as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas.parentElement).toBe(document.body);
    expect(canvas.style.position).toBe("fixed");
    expect(canvas.style.pointerEvents).toBe("none");
    expect(canvas.style.zIndex).toBe("40");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(canvas.width).toBe(window.innerWidth);
    expect(canvas.height).toBe(window.innerHeight);
  });

  it("caps the device pixel ratio at 1.5", () => {
    stubContext();
    stubFrames();
    vi.stubGlobal("devicePixelRatio", 3);
    startEffect("stars", "low", "");
    const canvas = document.getElementById(EXTRAS_EFFECT_ID) as HTMLCanvasElement;
    expect(canvas.width).toBe(Math.round(window.innerWidth * 1.5));
    expect(canvas.height).toBe(Math.round(window.innerHeight * 1.5));
  });

  it("keeps the canvas when the same effect is started again, replaces it otherwise", () => {
    stubContext();
    stubFrames();
    startEffect("bubbles", "low", "#FF00AA");
    const first = document.getElementById(EXTRAS_EFFECT_ID);
    startEffect("bubbles", "low", "#ff00aa");
    expect(document.getElementById(EXTRAS_EFFECT_ID)).toBe(first);

    startEffect("bubbles", "high", "#ff00aa");
    const second = document.getElementById(EXTRAS_EFFECT_ID);
    expect(second).not.toBe(first);
    expect(first!.isConnected).toBe(false);
    expect(canvases().length).toBe(1);

    startEffect("sakura", "high", "#ff00aa");
    expect(document.getElementById(EXTRAS_EFFECT_ID)).not.toBe(second);
    expect(canvases().length).toBe(1);
    expect(isEffectRunning()).toBe(true);
  });

  it("stops: canvas removed, frame cancelled, and stopping twice is fine", () => {
    stubContext();
    const frames = stubFrames();
    startEffect("confetti", "medium", "");
    expect(frames.pending()).toBe(1);
    stopEffect();
    expect(canvases().length).toBe(0);
    expect(isEffectRunning()).toBe(false);
    expect(frames.cancel).toHaveBeenCalled();
    expect(() => stopEffect()).not.toThrow();
    expect(isEffectRunning()).toBe(false);
  });

  it("stops what was running when asked for \"none\"", () => {
    stubContext();
    stubFrames();
    startEffect("rain", "medium", "");
    startEffect("none", "medium", "");
    expect(canvases().length).toBe(0);
    expect(isEffectRunning()).toBe(false);
  });

  it("removes a canvas left by another instance of the script", () => {
    stubContext();
    stubFrames();
    const stale = document.createElement("canvas");
    stale.id = EXTRAS_EFFECT_ID;
    document.body.appendChild(stale);
    startEffect("snow", "low", "");
    expect(stale.isConnected).toBe(false);
    expect(canvases().length).toBe(1);
  });

  it("creates nothing for visitors who prefer reduced motion", () => {
    stubContext();
    stubFrames();
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduce"), media: query }));
    (window as any).matchMedia = matchMedia;
    startEffect("fireflies", "high", "");
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(canvases().length).toBe(0);
    expect(isEffectRunning()).toBe(false);

    (window as any).matchMedia = vi.fn(() => ({ matches: false }));
    startEffect("fireflies", "high", "");
    expect(canvases().length).toBe(1);
  });

  it("draws every effect with the fake context, frame after frame", () => {
    const frames = stubFrames();
    for (const effect of ACTIVE) {
      const ctx = stubContext();
      startEffect(effect, "high", "");
      for (let i = 0; i < 5; i++) frames.run(1000 + i * 16);
      expect(ctx.clearRect, effect).toHaveBeenCalledTimes(5);
      expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, window.innerWidth, window.innerHeight);
      expect(frames.pending(), effect).toBe(1);
      const drawn =
        ctx.fill.mock.calls.length + ctx.stroke.mock.calls.length + ctx.fillRect.mock.calls.length;
      expect(drawn, effect).toBeGreaterThan(0);
      // only the glow effects pay for a shadow, and the state is left clean
      if (effect !== "fireflies" && effect !== "embers") expect(ctx.shadowBlur ?? 0).toBe(0);
      stopEffect();
      vi.restoreAllMocks();
    }
  });

  it("batches rain in a few strokes", () => {
    const ctx = stubContext();
    const frames = stubFrames();
    startEffect("rain", "high", "");
    frames.run(1000);
    expect(ctx.lineTo.mock.calls.length).toBeGreaterThan(10);
    expect(ctx.stroke.mock.calls.length).toBeLessThanOrEqual(3); // one per palette colour

    ctx.stroke.mockClear();
    startEffect("rain", "high", "#3366ff");
    frames.run(2000);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.strokeStyle).toBe("#3366ff");
  });

  it("paints with the tint when it is a strict #rrggbb, ignores it otherwise", () => {
    const ctx = stubContext();
    const frames = stubFrames();
    startEffect("snow", "low", "#12AbEf");
    frames.run(1000);
    expect(ctx.fillStyle).toBe("#12abef");

    const tinted = document.getElementById(EXTRAS_EFFECT_ID);
    let now = 2000;
    for (const bad of ["red", "#fff", "#12abef; } body { display:none", "url(https://x.test/a.png)", 42 as any]) {
      startEffect("snow", "low", bad);
      frames.run((now += 16));
      expect(ctx.fillStyle).toMatch(/^#[0-9a-f]{6}$/);
      expect(ctx.fillStyle).not.toBe("#12abef");
    }
    // every invalid tint is the same "no tint": the canvas of the first one was kept
    const plain = document.getElementById(EXTRAS_EFFECT_ID);
    expect(plain).not.toBe(tinted);
    startEffect("snow", "low", "");
    expect(document.getElementById(EXTRAS_EFFECT_ID)).toBe(plain);
  });

  it("skips drawing while the document is hidden", () => {
    const ctx = stubContext();
    const frames = stubFrames();
    startEffect("snow", "low", "");
    frames.run(1000);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    frames.run(1016);
    frames.run(1032);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(1); // still scheduled: it resumes by itself

    delete (document as any).hidden;
    frames.run(1048);
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
  });

  it("draws at most ~60 frames per second on high refresh rate screens", () => {
    const ctx = stubContext();
    const frames = stubFrames();
    startEffect("snow", "low", "");
    frames.run(1000);
    const before = ctx.arc.mock.calls.map((c) => c[1] as number);
    ctx.arc.mockClear();
    frames.run(1006); // 165 Hz
    frames.run(1012);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(1);
    frames.run(1018);
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    // the skipped frames are not lost time: snow (34-79 px/s) fell for 18 ms, not for 6
    const after = ctx.arc.mock.calls.map((c) => c[1] as number);
    const fell = after.filter((y, i) => y - before[i] > 0.5 && y - before[i] < 1.5).length;
    expect(fell).toBeGreaterThanOrEqual(after.length - 1);
  });

  it("clamps the time step, so a long pause does not throw the particles away", () => {
    const ctx = stubContext();
    const frames = stubFrames();
    startEffect("snow", "low", "");
    frames.run(1000);
    const before = ctx.arc.mock.calls.map((c) => c[1] as number);
    ctx.arc.mockClear();
    frames.run(1000 + 60_000);
    const after = ctx.arc.mock.calls.map((c) => c[1] as number);
    expect(after.length).toBe(before.length);
    // snow falls at < 80 px/s: 50 ms is a few pixels, a minute would be thousands
    const moved = after.filter((y, i) => Math.abs(y - before[i]) < 6).length;
    expect(moved).toBeGreaterThanOrEqual(after.length - 1);
  });

  it("stops by itself when the page drops the canvas", () => {
    stubContext();
    const frames = stubFrames();
    startEffect("snow", "low", "");
    document.body.replaceChildren();
    frames.run(1000);
    expect(isEffectRunning()).toBe(false);
    expect(frames.pending()).toBe(0);
  });

  it("follows window resizes, debounced, until it is stopped", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubContext();
    stubFrames();
    const width = window.innerWidth;
    const height = window.innerHeight;
    try {
      startEffect("snow", "high", "");
      const canvas = document.getElementById(EXTRAS_EFFECT_ID) as HTMLCanvasElement;
      (window as any).innerWidth = 640;
      (window as any).innerHeight = 480;
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(50);
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(100);
      expect(canvas.width).toBe(width); // still waiting for the resize to settle
      vi.advanceTimersByTime(200);
      expect(canvas.width).toBe(640);
      expect(canvas.height).toBe(480);
      expect(document.getElementById(EXTRAS_EFFECT_ID)).toBe(canvas);

      stopEffect();
      (window as any).innerWidth = 800;
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(1000);
      expect(canvas.width).toBe(640);
      expect(canvases().length).toBe(0);
    } finally {
      (window as any).innerWidth = width;
      (window as any).innerHeight = height;
    }
  });
});
