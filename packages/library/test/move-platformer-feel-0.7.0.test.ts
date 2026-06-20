import { describe, it, expect } from "vitest";
import type { World } from "@gitcade/sdk";
import { makeWorld, makeEntity, runBehavior } from "./helpers.js";
import { movePlatformer } from "../src/behaviors/move-platformer.js";

const DT = 1 / 60;

/**
 * The move-platformer genre-feel layer ("proper platformer mover"). Every feel mechanic is
 * an OPTIONAL param defaulting to the bare-mover behavior; these tests pin both the feel
 * AND that the defaults are no-ops.
 */

function setInput(world: World, opts: { axis?: number; jump?: boolean }): void {
  const input = world.input as unknown as { axis: () => number; anyDown: () => boolean };
  input.axis = () => opts.axis ?? 0;
  input.anyDown = () => opts.jump ?? false;
}

/** Key-aware stub: `anyDown(keys)` is true iff one of `keys` is in the held set (drop-through
 *  needs `jump` vs `down` keys distinguished, which the fixed-value `setInput` can't do). */
function setKeys(world: World, opts: { axis?: number; held?: string[] }): void {
  const held = new Set(opts.held ?? []);
  const input = world.input as unknown as { axis: () => number; anyDown: (keys: string[]) => boolean };
  input.axis = () => opts.axis ?? 0;
  input.anyDown = (keys: string[]) => keys.some((k) => held.has(k));
}

describe("move-platformer — run acceleration / friction", () => {
  it("with no accel, vx snaps to the target (original instant feel)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    setInput(world, { axis: 1 });
    runBehavior(movePlatformer, e, world, { moveSpeed: 180 }, DT);
    expect(e.vx).toBe(180);
  });

  it("accel ramps vx toward the target instead of snapping, then clamps", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    setInput(world, { axis: 1 });
    runBehavior(movePlatformer, e, world, { moveSpeed: 180, accel: 1200 }, DT);
    expect(e.vx).toBeCloseTo(20, 6); // 1200 * (1/60)
    runBehavior(movePlatformer, e, world, { moveSpeed: 180, accel: 1200 }, DT);
    expect(e.vx).toBeCloseTo(40, 6);
    for (let i = 0; i < 20; i++) runBehavior(movePlatformer, e, world, { moveSpeed: 180, accel: 1200 }, DT);
    expect(e.vx).toBe(180); // clamped at the target, no overshoot
  });

  it("friction decays vx to rest when there is no input (accel mode)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.vx = 180;
    setInput(world, { axis: 0 });
    runBehavior(movePlatformer, e, world, { moveSpeed: 180, accel: 1200, friction: 600 }, DT);
    expect(e.vx).toBeCloseTo(170, 6); // 180 - 600/60
  });
});

describe("move-platformer — variable jump height (release-to-cut)", () => {
  function launchThenRelease(jumpCutMultiplier?: number): number {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.body.contacts.onGround = true;
    const params = { jumpSpeed: 400, gravity: 1000, ...(jumpCutMultiplier !== undefined ? { jumpCutMultiplier } : {}) };
    setInput(world, { jump: true }); // tick 1: launch while grounded
    runBehavior(movePlatformer, e, world, params, DT);
    e.body.contacts.onGround = false;
    setInput(world, { jump: false }); // tick 2: release while rising
    runBehavior(movePlatformer, e, world, params, DT);
    return e.vy;
  }

  it("releasing jump while rising trims the climb", () => {
    // tick 1: vy = -400 + g·dt = -383.33; tick 2 release: ×0.5 = -191.67, + g·dt = -175.
    expect(launchThenRelease(0.5)).toBeCloseTo(-175, 2);
  });

  it("default jumpCutMultiplier (1) does NOT cut — full fixed-impulse jump", () => {
    // tick 2 with no cut: -383.33 + g·dt = -366.67 (much higher climb retained).
    expect(launchThenRelease()).toBeCloseTo(-366.67, 1);
  });
});

describe("move-platformer — jump buffering", () => {
  function pressAirborneThenLand(jumpBuffer?: number): number {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" }); // airborne (contacts default all-false)
    const params = { jumpSpeed: 400, gravity: 1000, ...(jumpBuffer !== undefined ? { jumpBuffer } : {}) };
    setInput(world, { jump: true }); // tick 1: press while airborne (held through)
    runBehavior(movePlatformer, e, world, params, DT);
    e.body.contacts.onGround = true; // tick 2: land (jump still held → not a fresh press)
    runBehavior(movePlatformer, e, world, params, DT);
    return e.vy;
  }

  it("a press held into landing fires the jump on the landing tick", () => {
    expect(pressAirborneThenLand(0.15)).toBeLessThan(0); // buffered jump fired
  });

  it("without a buffer, the held (non-fresh) press is dropped on landing", () => {
    expect(pressAirborneThenLand()).toBeGreaterThan(0); // only gravity, no late jump
  });
});

describe("move-platformer — apex hang", () => {
  it("reduces gravity near the top of the arc (|vy| < apexThreshold)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.vy = -50; // near apex
    setInput(world, {});
    runBehavior(movePlatformer, e, world, { gravity: 1000, apexGravityMult: 0.5, apexThreshold: 100 }, DT);
    expect(e.vy).toBeCloseTo(-50 + (1000 * 0.5) / 60, 4); // half gravity ⇒ floatier
  });

  it("applies full gravity outside the threshold (fast fall)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.vy = 300; // |vy| > 100
    setInput(world, {});
    runBehavior(movePlatformer, e, world, { gravity: 1000, apexGravityMult: 0.5, apexThreshold: 100 }, DT);
    expect(e.vy).toBeCloseTo(300 + 1000 / 60, 4);
  });

  it("default apexGravityMult (1) leaves gravity unchanged near the apex", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.vy = -50;
    setInput(world, {});
    runBehavior(movePlatformer, e, world, { gravity: 1000 }, DT);
    expect(e.vy).toBeCloseTo(-50 + 1000 / 60, 4); // full gravity
  });
});

describe("move-platformer — drop-through (down + jump on a one-way platform)", () => {
  const params = { jumpSpeed: 400, gravity: 1000, jump: ["Space"], down: ["ArrowDown"], dropThroughTime: 0.2 };

  it("down + jump while standing on a ONE-WAY platform opens the drop window and does NOT jump", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.body.contacts.onGround = true;
    e.body.contacts.onOneWay = true;
    setKeys(world, { held: ["ArrowDown", "Space"] });
    runBehavior(movePlatformer, e, world, params, DT);
    expect(e.body.dropThrough).toBeCloseTo(0.2, 6); // window opened
    expect(e.vy).toBeGreaterThan(0); // fell under gravity — did NOT launch upward
  });

  it("on a fully SOLID floor, down + jump jumps normally (no drop window)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.body.contacts.onGround = true; // fully solid floor (onOneWay stays false)
    setKeys(world, { held: ["ArrowDown", "Space"] });
    runBehavior(movePlatformer, e, world, params, DT);
    expect(e.vy).toBeLessThan(0); // jumped
    expect(e.body.dropThrough).toBe(0);
  });

  it("the drop window counts down each tick", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.body.dropThrough = 0.2;
    setKeys(world, {});
    runBehavior(movePlatformer, e, world, params, DT);
    expect(e.body.dropThrough).toBeCloseTo(0.2 - DT, 6);
  });

  it("default mover (no `down`/`dropThroughTime`) never opens a drop window", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.body.contacts.onGround = true;
    e.body.contacts.onOneWay = true;
    setKeys(world, { held: ["Space"] }); // jump only
    runBehavior(movePlatformer, e, world, { jumpSpeed: 400, gravity: 1000 }, DT);
    expect(e.body.dropThrough).toBe(0);
    expect(e.vy).toBeLessThan(0); // a plain jump
  });
});
