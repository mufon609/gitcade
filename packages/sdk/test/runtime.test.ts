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
  it("flips x velocity away from the obstacle on collision", () => {
    const world = makeWorld();
    const fn = world.registry.getBehavior("reflect-on-hit")!.fn;
    const ball = new Entity({ id: "ball", x: 30, y: 0, w: 10, h: 10, layer: 0, tags: ["ball"], sprite: { kind: "none" } });
    const paddle = new Entity({ id: "pad", x: 36, y: 0, w: 10, h: 40, layer: 0, tags: ["paddle"], sprite: { kind: "none" } });
    ball.vx = 200; // moving right, into the paddle on its right
    ball.collisions = [paddle];
    fn(ball, world, { tag: "paddle", axis: "x", speedScale: 1 }, 1 / 60);
    expect(ball.vx).toBeLessThan(0); // reflected leftwards (away from paddle center)
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
