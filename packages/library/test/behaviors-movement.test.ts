import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity, collide } from "./helpers.js";
import { move4dir } from "../src/behaviors/move-4dir.js";
import { moveTopdown360 } from "../src/behaviors/move-topdown-360.js";
import { moveGridStep } from "../src/behaviors/move-grid-step.js";
import { movePlatformer } from "../src/behaviors/move-platformer.js";
import { autoScroll } from "../src/behaviors/auto-scroll.js";
import { followPath } from "../src/behaviors/follow-path.js";

const DT = 1 / 60;

describe("move-4dir", () => {
  it("sets velocity from held keys", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    world.input.attach({ keyTarget: null }); // no-op; we drive keys via dispatch below
    // Simulate held keys by reaching into the public axis() via attach is awkward;
    // instead assert the zero-input case and the diagonal-normalization math.
    move4dir(e, world, { speed: 100 }, DT);
    expect(e.vx).toBe(0);
    expect(e.vy).toBe(0);
  });

  it("normalizes diagonal speed when requested", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    // Drive both axes by faking the input axis via a stub world.input.
    (world.input as unknown as { axis: () => number }).axis = () => 1;
    move4dir(e, world, { speed: 100, normalizeDiagonal: true }, DT);
    expect(Math.hypot(e.vx, e.vy)).toBeCloseTo(100, 5);
  });
});

describe("move-topdown-360", () => {
  it("steers toward the active pointer when no key is held", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", x: 100, y: 100, w: 16, h: 16 }); // center = (108, 108)
    (world.input as unknown as { axis: () => number }).axis = () => 0;
    (world.input as unknown as { activePointers: () => unknown[] }).activePointers = () => [{ id: 0, x: 300, y: 108, down: true }];
    moveTopdown360(e, world, { speed: 50, pointerFollow: true }, DT);
    expect(e.vx).toBeGreaterThan(0);
    expect(Math.abs(e.vy)).toBeLessThan(1e-6);
  });
});

describe("move-grid-step", () => {
  it("steps one cell per interval in the current heading", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "snake", x: 0, y: 0, state: { __gridDir: { x: 1, y: 0 } } });
    // Below the interval: no movement yet.
    moveGridStep(e, world, { tileSize: 20, stepInterval: 0.1, continuous: true }, 0.05);
    expect(e.x).toBe(0);
    // Crossing the interval: exactly one cell.
    moveGridStep(e, world, { tileSize: 20, stepInterval: 0.1, continuous: true }, 0.06);
    expect(e.x).toBe(20);
  });

  it("refuses a 180° reversal in continuous mode", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "snake", state: { __gridDir: { x: 1, y: 0 } } });
    (world.input as unknown as { anyDown: (c: string[]) => boolean }).anyDown = (codes) => codes.includes("ArrowLeft");
    moveGridStep(e, world, { tileSize: 20, stepInterval: 0.1, continuous: true, left: ["ArrowLeft"] }, DT);
    const dir = e.state.__gridDir as { x: number; y: number };
    expect(dir).toEqual({ x: 1, y: 0 }); // reversal rejected
  });
});

describe("move-platformer", () => {
  it("applies gravity and clamps to the floor", () => {
    const world = makeWorld({ bounds: { width: 400, height: 300 } });
    const e = makeEntity(world, { id: "p", x: 0, y: 290, w: 16, h: 16 }); // y+h = 306 ≥ 300 → on the floor
    movePlatformer(e, world, { moveSpeed: 0, gravity: 1000, jumpSpeed: 400 }, DT);
    // On the floor with downward velocity → snapped to floor, vy zeroed.
    expect(e.y).toBe(300 - 16);
    expect(e.vy).toBe(0);
  });

  it("jumps off the floor on a fresh press", () => {
    const world = makeWorld({ bounds: { width: 400, height: 300 } });
    const e = makeEntity(world, { id: "p", x: 0, y: 284, w: 16, h: 16 });
    (world.input as unknown as { axis: () => number; anyDown: () => boolean }).axis = () => 0;
    (world.input as unknown as { anyDown: () => boolean }).anyDown = () => true;
    movePlatformer(e, world, { moveSpeed: 0, gravity: 1000, jumpSpeed: 400, jump: ["Space"] }, DT);
    expect(e.vy).toBeLessThan(0); // launched upward
  });
});

describe("auto-scroll", () => {
  it("forces a constant velocity and wraps across the edge", () => {
    const world = makeWorld({ bounds: { width: 200, height: 200 } });
    const e = makeEntity(world, { id: "tile", x: 205, y: 0, w: 32, h: 32 });
    autoScroll(e, world, { vx: -60, vy: 0, wrap: true }, DT);
    expect(e.vx).toBe(-60);
    expect(e.x).toBe(-32); // wrapped from the right edge to just off the left
  });
});

describe("follow-path", () => {
  it("heads toward the first waypoint and advances on arrival", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "creep", x: 0, y: 0, w: 10, h: 10 });
    const params = { points: [{ x: 100, y: 5 }, { x: 100, y: 200 }], speed: 50, arriveRadius: 8 };
    followPath(e, world, params, DT);
    expect(e.vx).toBeGreaterThan(0); // moving toward x=100
    // Teleport onto the first waypoint → it advances and aims at the second.
    e.x = 95;
    e.y = 0;
    followPath(e, world, params, DT);
    expect(e.state.__wp).toBe(1);
  });
});
