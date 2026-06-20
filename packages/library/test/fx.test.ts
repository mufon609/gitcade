import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity } from "./helpers.js";
import { spawnBurst, ScreenEffects, attachScreenEffects } from "../src/fx/index.js";

describe("fx/particle — spawnBurst", () => {
  it("spawns the requested count of fx particles with the particle behavior", () => {
    const world = makeWorld({ seed: 7 });
    spawnBurst(world, { x: 100, y: 100, count: 10, speed: 100, ttl: 0.5, size: 4, colors: ["#ffcd75"] });
    const particles = world.query("particle");
    expect(particles).toHaveLength(10);
    expect(particles[0]!.behaviors.some((b) => b.type === "particle")).toBe(true);
  });

  it("particles move, shrink, and die SILENTLY at ttl (no sound)", () => {
    let sounds = 0;
    const world = makeWorld({ seed: 3 });
    // Spy on audio: replace play with a counter (world.audio is the SDK AudioPlayer).
    (world.audio as unknown as { play: () => void }).play = () => {
      sounds += 1;
    };
    spawnBurst(world, { x: 50, y: 50, count: 4, speed: 120, ttl: 0.2, size: 6, colors: ["#fff"] });
    const p = world.query("particle")[0]!;
    const x0 = p.x;
    const registry = world.registry;
    const fn = registry.getBehavior("particle")!.fn;
    // Step the particle manually for 0.1s — it should move and shrink.
    for (let i = 0; i < 6; i++) fn(p, world, { ttl: 0.2, gravity: 0, shrink: true }, 1 / 60);
    expect(p.x).not.toBe(x0);
    expect(p.w).toBeLessThan(6);
    // Step past ttl → dead, and no sound was ever played.
    for (let i = 0; i < 12; i++) fn(p, world, { ttl: 0.2, gravity: 0, shrink: true }, 1 / 60);
    expect(p.alive).toBe(false);
    expect(sounds).toBe(0);
  });
});

describe("fx/emitters — event-driven systems", () => {
  it("explosion bursts particles when its event fires, at the event position", () => {
    const world = makeWorld({ seed: 11 });
    const explosion = world.registry.getSystem("explosion")!.fn;
    // First tick attaches the listener (no event yet → no particles). `scratch` is the per-instance
    // store the host hands back each tick; the system guards its once-per-scene attach on it.
    const scratch = {};
    explosion(world, { event: "boom", count: 8, speed: 100, ttl: 0.4, size: 4, gravity: 0 }, 1 / 60, scratch);
    expect(world.query("particle")).toHaveLength(0);
    world.events.emit("boom", { x: 200, y: 150 });
    const particles = world.query("particle");
    expect(particles).toHaveLength(8);
    // Particles spawn centered on the event point.
    expect(Math.abs(particles[0]!.cx - 200)).toBeLessThan(2);
  });

  it("attaches its listener only once across many ticks", () => {
    const world = makeWorld({ seed: 1 });
    const sparkle = world.registry.getSystem("sparkle")!.fn;
    // The host hands the SAME scratch object back every tick; sharing it across the 5 calls is what
    // makes the once-per-scene attach guard dedup (a fresh scratch each call would re-attach 5×).
    const scratch = {};
    for (let i = 0; i < 5; i++) sparkle(world, { event: "ping", count: 3, speed: 50, ttl: 0.5, size: 3, gravity: 0 }, 1 / 60, scratch);
    world.events.emit("ping", { x: 10, y: 10 });
    // A single attachment → exactly one burst of 3, not 5×3.
    expect(world.query("particle")).toHaveLength(3);
  });

  it("trail behavior drips a particle once per rate window", () => {
    const world = makeWorld({ seed: 5 });
    const e = makeEntity(world, { id: "comet", x: 100, y: 100, tags: ["proj"] });
    const trail = world.registry.getBehavior("trail")!.fn;
    // 0.04s rate; step 0.02 twice → one drip on the second.
    trail(e, world, { rate: 0.04, ttl: 0.3, size: 4, color: "#41a6f6" }, 0.02);
    expect(world.query("particle")).toHaveLength(0);
    trail(e, world, { rate: 0.04, ttl: 0.3, size: 4, color: "#41a6f6" }, 0.02);
    expect(world.query("particle")).toHaveLength(1);
  });
});

describe("fx/screen-effects — deterministic host controller", () => {
  it("shake decays to zero over its duration and is reproducible", () => {
    const a = new ScreenEffects();
    const b = new ScreenEffects();
    a.shake(10, 0.3, 40);
    b.shake(10, 0.3, 40);
    let fa = a.update(0.1);
    let fb = b.update(0.1);
    expect(fa).toEqual(fb); // deterministic, no RNG
    expect(Math.abs(fa.dx) + Math.abs(fa.dy)).toBeGreaterThan(0);
    a.update(0.1);
    const settled = a.update(0.2); // past 0.3s total
    expect(Math.abs(settled.dx)).toBe(0);
    expect(Math.abs(settled.dy)).toBe(0);
  });

  it("flash fades from full to zero alpha", () => {
    const fx = new ScreenEffects();
    fx.flash("#f4f4f4", 0.2);
    const f1 = fx.update(0.05);
    expect(f1.flashAlpha).toBeGreaterThan(0.5);
    const f2 = fx.update(0.2);
    expect(f2.flashAlpha).toBe(0);
  });

  it("fadeOut covers the screen and bindToEvents wires triggers", () => {
    const world = makeWorld();
    const fx = new ScreenEffects();
    fx.bindToEvents(world, { "player-died": (f) => f.fadeOut("#1a1c2c", 0.4) });
    world.events.emit("player-died", {});
    const f = fx.update(0.4);
    expect(f.fadeAlpha).toBeCloseTo(1, 5);
  });

  it("attachScreenEffects shakes the overlay WITH the canvas (no flash slide-off)", () => {
    // Stub the animation clock so the rAF loop runs deterministically under node.
    const origRaf = globalThis.requestAnimationFrame;
    const origCancel = globalThis.cancelAnimationFrame;
    const origNow = performance.now;
    let loop: ((t: number) => void) | null = null;
    globalThis.requestAnimationFrame = ((cb: (t: number) => void) => {
      loop = cb;
      return 1;
    }) as never;
    globalThis.cancelAnimationFrame = (() => {}) as never;
    performance.now = () => 0; // initial `last` = 0 so the first dt is well-defined
    try {
      const fx = new ScreenEffects();
      const canvas = { style: { transform: "" } };
      const overlay = { style: {} as Record<string, string> };
      const stop = attachScreenEffects(fx, canvas, overlay);
      fx.shake(12, 0.4, 40);
      loop!(0); // t0 — primes `last`
      loop!(100); // ~100ms later → a non-zero shake offset this frame
      // Both the canvas and the flash/fade overlay carry the SAME translate, so the
      // overlay can't slide off the shaking play-field.
      expect(canvas.style.transform).toMatch(/^translate\(/);
      expect(overlay.style.transform).toBe(canvas.style.transform);
      expect(canvas.style.transform).not.toBe("translate(0.00px, 0.00px)");
      stop();
    } finally {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancel;
      performance.now = origNow;
    }
  });
});
