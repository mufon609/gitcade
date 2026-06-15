import { describe, it, expect } from "vitest";
import {
  Game,
  World,
  Entity,
  createDefaultRegistry,
  resolveParams,
  aabbOverlap,
  type Scene,
  type Config,
} from "../src/index.js";

function makeWorld(config: Config = {}): World {
  return new World({
    bounds: { width: 800, height: 600 },
    config,
    registry: createDefaultRegistry(),
  });
}

describe("param resolution", () => {
  it("replaces $cfg refs with config values, deeply", () => {
    const cfg = { speed: 7, reset: { x: 1 } };
    const resolved = resolveParams(
      { speed: "$cfg.speed", nested: { v: "$cfg.reset.x" }, keep: "literal", n: 3 },
      cfg,
    );
    expect(resolved).toEqual({ speed: 7, nested: { v: 1 }, keep: "literal", n: 3 });
  });
  it("throws on an unresolved ref", () => {
    expect(() => resolveParams({ a: "$cfg.missing" }, {})).toThrow(/unresolved/);
  });
});

describe("collision", () => {
  it("detects overlap and ignores separated boxes", () => {
    expect(aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(aabbOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe("velocity behavior", () => {
  it("seeds initial velocity from params then integrates position", () => {
    const world = makeWorld({ vx: 60, vy: 0 });
    const fn = world.registry.getBehavior("velocity")!.fn;
    const e = new Entity({ id: "b", x: 0, y: 0, w: 8, h: 8, layer: 0, sprite: { kind: "none" } });
    const params = resolveParams({ vx: "$cfg.vx", vy: "$cfg.vy" }, world.config);
    fn(e, world, params, 0.5);
    expect(e.vx).toBe(60);
    expect(e.x).toBeCloseTo(30); // 60 px/s * 0.5 s
  });
});

describe("clamp-to-world behavior", () => {
  it("keeps an entity inside the bounds and zeroes the clamped velocity", () => {
    const world = makeWorld();
    const fn = world.registry.getBehavior("clamp-to-world")!.fn;
    const e = new Entity({ id: "p", x: 0, y: -50, w: 10, h: 50, layer: 0, sprite: { kind: "none" } });
    e.vy = -100;
    fn(e, world, { axis: "y", padding: 5 }, 1 / 60);
    expect(e.y).toBe(5);
    expect(e.vy).toBe(0);
  });
});

describe("reflect-on-hit behavior", () => {
  const reflect = (world: World) => world.registry.getBehavior("reflect-on-hit")!.fn;

  it("flips x velocity away from the obstacle on collision", () => {
    const world = makeWorld();
    const ball = new Entity({ id: "ball", x: 30, y: 0, w: 10, h: 10, layer: 0, tags: ["ball"], sprite: { kind: "none" } });
    const paddle = new Entity({ id: "pad", x: 36, y: 0, w: 10, h: 40, layer: 0, tags: ["paddle"], sprite: { kind: "none" } });
    ball.vx = 200; // moving right, into the paddle on its right
    ball.collisions = [paddle];
    reflect(world)(ball, world, { tag: "paddle", axis: "x", speedScale: 1 }, 1 / 60);
    expect(ball.vx).toBeLessThan(0); // reflected leftwards (away from paddle center)
  });

  // --- B-3: axis:"auto" picks the flip axis per-hit from the actual overlap ---
  it('axis:"auto" reflects X on a side hit (no tunneling)', () => {
    const world = makeWorld();
    // Ball overlaps the brick more vertically than horizontally → a SIDE hit.
    const ball = new Entity({ id: "ball", x: 30, y: 0, w: 10, h: 10, layer: 0, tags: ["ball"], sprite: { kind: "none" } });
    const brick = new Entity({ id: "brk", x: 36, y: -20, w: 20, h: 50, layer: 0, tags: ["brick"], sprite: { kind: "none" } });
    ball.vx = 200; // driving right INTO the brick's left face
    ball.vy = 0;
    ball.collisions = [brick];
    reflect(world)(ball, world, { tag: "brick", axis: "auto", speedScale: 1 }, 1 / 60);
    expect(ball.vx).toBeLessThan(0); // flipped on X — reflected, did NOT tunnel through
    expect(ball.vy).toBe(0); // Y untouched on a side hit
  });

  it('axis:"auto" reflects Y on a top hit', () => {
    const world = makeWorld();
    // Ball overlaps the brick more horizontally than vertically → a TOP hit.
    const ball = new Entity({ id: "ball", x: 30, y: 30, w: 10, h: 10, layer: 0, tags: ["ball"], sprite: { kind: "none" } });
    const brick = new Entity({ id: "brk", x: 20, y: 36, w: 40, h: 20, layer: 0, tags: ["brick"], sprite: { kind: "none" } });
    ball.vx = 0;
    ball.vy = 200; // driving down INTO the brick's top face
    ball.collisions = [brick];
    reflect(world)(ball, world, { tag: "brick", axis: "auto", speedScale: 1 }, 1 / 60);
    expect(ball.vy).toBeLessThan(0); // flipped on Y
    expect(ball.vx).toBe(0); // X untouched on a top hit
  });

  it('axis:"x"/"y" remain a FIXED axis (byte-identical — Pong relies on this)', () => {
    const world = makeWorld();
    // Same geometry as the auto side-hit, but force axis:"y" → it must STILL flip
    // Y (the legacy fixed behavior), proving "x"/"y" are unaffected by the auto path.
    const ball = new Entity({ id: "ball", x: 30, y: 0, w: 10, h: 10, layer: 0, tags: ["ball"], sprite: { kind: "none" } });
    const brick = new Entity({ id: "brk", x: 36, y: -20, w: 20, h: 50, layer: 0, tags: ["brick"], sprite: { kind: "none" } });
    ball.vx = 200;
    ball.vy = 120;
    ball.collisions = [brick];
    reflect(world)(ball, world, { tag: "brick", axis: "y", speedScale: 1 }, 1 / 60);
    expect(ball.vx).toBe(200); // X never touched under fixed axis:"y"
    // dir = sign(ball.cy - brick.cy) = sign(5 - 5) = 0 → fallback 1; v = |120| → +120
    expect(ball.vy).toBe(120);
  });

  // --- B-4: english can no longer push the perpendicular axis past maxSpeed ---
  it("clamps the english-modified axis to maxSpeed", () => {
    const world = makeWorld();
    const ball = new Entity({ id: "ball", x: 30, y: 35, w: 10, h: 10, layer: 0, tags: ["ball"], sprite: { kind: "none" } });
    const paddle = new Entity({ id: "pad", x: 36, y: 0, w: 10, h: 40, layer: 0, tags: ["paddle"], sprite: { kind: "none" } });
    ball.vx = 200;
    ball.vy = 0; // offset = (40-20)/(40/2) = 1 → english would add +500
    ball.collisions = [paddle];
    reflect(world)(ball, world, { tag: "paddle", axis: "x", speedScale: 1, maxSpeed: 100, english: 500 }, 1 / 60);
    expect(ball.vy).toBe(100); // capped (was 500 uncapped) — B-4
    expect(Math.abs(ball.vx)).toBeLessThanOrEqual(100); // reflected axis still capped too
  });

  it("leaves english within maxSpeed untouched (no-op clamp — Pong feel preserved)", () => {
    const world = makeWorld();
    const ball = new Entity({ id: "ball", x: 30, y: 35, w: 10, h: 10, layer: 0, tags: ["ball"], sprite: { kind: "none" } });
    const paddle = new Entity({ id: "pad", x: 36, y: 0, w: 10, h: 40, layer: 0, tags: ["paddle"], sprite: { kind: "none" } });
    ball.vx = 200;
    ball.vy = 0; // offset 1 → +50, well under the 680 cap
    ball.collisions = [paddle];
    reflect(world)(ball, world, { tag: "paddle", axis: "x", speedScale: 1, maxSpeed: 680, english: 50 }, 1 / 60);
    expect(ball.vy).toBe(50); // english applied unchanged when under the cap
  });
});

describe("aabb-collision system", () => {
  it("populates entity.collisions for the configured tag pair", () => {
    const world = makeWorld();
    const sys = world.registry.getSystem("aabb-collision")!.fn;
    const a = world.add(new Entity({ id: "a", x: 0, y: 0, w: 20, h: 20, layer: 0, tags: ["ball"], sprite: { kind: "none" } }));
    const b = world.add(new Entity({ id: "b", x: 10, y: 10, w: 20, h: 20, layer: 0, tags: ["paddle"], sprite: { kind: "none" } }));
    sys(world, { pairs: [["ball", "paddle"]] }, 1 / 60);
    expect(a.collisions).toContain(b);
    expect(b.collisions).toContain(a);
  });
});

describe("Game headless loop", () => {
  const scene: Scene = {
    id: "main",
    size: { width: 200, height: 200 },
    entities: [
      {
        id: "ball",
        sprite: { kind: "shape", shape: "circle", color: "#fff" },
        size: { w: 10, h: 10 },
        position: { x: 50, y: 50 },
        tags: ["ball"],
        layer: 0,
        behaviors: [
          { type: "bounce-world-edges", params: { edges: ["left", "right", "top", "bottom"], restitution: 1 } },
          { type: "velocity", params: { vx: "$cfg.vx", vy: "$cfg.vy" } },
        ],
      },
    ],
    systems: [],
  } as unknown as Scene;

  it("runs frames, advances the frame counter, and keeps the ball in bounds", () => {
    const game = new Game({ scenes: [scene], config: { vx: 300, vy: 220 }, canvas: null });
    game.stepFrames(120);
    expect(game.world.frame).toBe(120);
    const ball = game.world.byId("ball")!;
    expect(ball.x).toBeGreaterThanOrEqual(0);
    expect(ball.x).toBeLessThanOrEqual(200);
    expect(ball.y).toBeGreaterThanOrEqual(0);
    expect(ball.y).toBeLessThanOrEqual(200);
  });
});

describe("entity spawn/destroy", () => {
  it("spawns and prunes entities", () => {
    const world = makeWorld();
    world.spawn({
      id: "x",
      sprite: { kind: "none" },
      size: { w: 1, h: 1 },
      position: { x: 0, y: 0 },
      behaviors: [],
      tags: ["t"],
      layer: 0,
    } as never);
    expect(world.query("t").length).toBe(1);
    world.destroy(world.byId("x")!);
    world.prune();
    expect(world.query("t").length).toBe(0);
  });
});
