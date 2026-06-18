import { describe, it, expect } from "vitest";
import type { Sprite } from "@gitcade/sdk";
import { makeWorld, makeEntity } from "./helpers.js";
import { spriteStateMachine } from "../src/behaviors/sprite-state-machine.js";
import { faceVelocity } from "../src/behaviors/face-velocity.js";

const DT = 1 / 60;

/**
 * 0.7.0 — the animation layer (INDIE-ROADMAP Tier-1 "feels like a platformer"):
 *  - sprite-state-machine maps motion state (grounded/vx/vy) → a named sheet clip,
 *    with a one-shot land that holds until it finishes.
 *  - face-velocity flips entity.scaleX to face the movement direction.
 */

/** A sheet sprite with the conventional idle/run/jump/fall/land clips. */
function sheet(): Sprite {
  return {
    kind: "sheet",
    src: "p.png",
    frameWidth: 16,
    frameHeight: 16,
    frameCount: 10,
    fps: 10,
    animations: {
      idle: { from: 0, to: 1, fps: 4, loop: true },
      run: { from: 2, to: 5, fps: 12, loop: true },
      jump: { from: 6, to: 6, fps: 10, loop: false },
      fall: { from: 7, to: 7, fps: 10, loop: false },
      land: { from: 8, to: 9, fps: 20, loop: false },
    },
  };
}

describe("sprite-state-machine — motion → clip", () => {
  it("idle when grounded and still", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", sprite: sheet() });
    e.contacts.onGround = true;
    e.vx = 0;
    spriteStateMachine(e, world, {}, DT);
    expect(e.anim.current).toBe("idle");
  });

  it("run when grounded and moving past the threshold", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", sprite: sheet() });
    e.contacts.onGround = true;
    e.vx = 120;
    spriteStateMachine(e, world, {}, DT);
    expect(e.anim.current).toBe("run");
  });

  it("stays idle below the move threshold", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", sprite: sheet() });
    e.contacts.onGround = true;
    e.vx = 0.5; // < default threshold 1
    spriteStateMachine(e, world, {}, DT);
    expect(e.anim.current).toBe("idle");
  });

  it("jump while airborne and rising (vy < 0)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", sprite: sheet() });
    e.vy = -200;
    spriteStateMachine(e, world, {}, DT);
    expect(e.anim.current).toBe("jump");
  });

  it("fall while airborne and descending (vy ≥ 0)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", sprite: sheet() });
    e.vy = 200;
    spriteStateMachine(e, world, {}, DT);
    expect(e.anim.current).toBe("fall");
  });

  it("fires the land one-shot on touchdown, holds it, then returns to idle", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", sprite: sheet() });
    e.vy = 200;
    spriteStateMachine(e, world, {}, DT); // airborne → fall (marks __smAir)
    expect(e.anim.current).toBe("fall");

    e.contacts.onGround = true; // touchdown
    e.vy = 0;
    e.vx = 0;
    spriteStateMachine(e, world, {}, DT);
    expect(e.anim.current).toBe("land"); // one-shot fired

    // It HOLDS land for the next couple of ticks (not yet finished)...
    spriteStateMachine(e, world, {}, DT);
    expect(e.anim.current).toBe("land");

    // ...then completes and falls back to idle once the non-looping clip ends.
    for (let i = 0; i < 12; i++) spriteStateMachine(e, world, {}, DT);
    expect(e.anim.current).toBe("idle");
  });

  it("a disabled state ('' clip) falls back — jump:'' makes a rising body use fall", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", sprite: sheet() });
    e.vy = -200; // rising, but no jump clip configured
    spriteStateMachine(e, world, { jump: "" }, DT);
    expect(e.anim.current).toBe("fall");
  });

  it("no-op for a non-sheet sprite", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", sprite: { kind: "shape", shape: "rect", color: "#fff" } });
    e.contacts.onGround = true;
    expect(() => spriteStateMachine(e, world, {}, DT)).not.toThrow();
    expect(e.anim.current).toBeNull(); // untouched
  });
});

describe("face-velocity — horizontal flip convention", () => {
  it("faces right (scaleX > 0) when moving right", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.vx = 80;
    faceVelocity(e, world, {}, DT);
    expect(e.scaleX).toBe(1);
  });

  it("faces left (scaleX < 0) when moving left", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.vx = -80;
    faceVelocity(e, world, {}, DT);
    expect(e.scaleX).toBe(-1);
  });

  it("holds the current facing below the threshold", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.scaleX = -1; // was facing left
    e.vx = 0.5; // < default threshold 1
    faceVelocity(e, world, {}, DT);
    expect(e.scaleX).toBe(-1); // unchanged
  });

  it("preserves the scale magnitude when flipping", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.scaleX = 2; // authored 2× scale
    e.vx = -80;
    faceVelocity(e, world, {}, DT);
    expect(e.scaleX).toBe(-2); // flipped sign, magnitude kept
  });

  it("invert maps moving-right to a left-facing scaleX (art faces left by default)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.vx = 80; // moving right
    faceVelocity(e, world, { invert: true }, DT);
    expect(e.scaleX).toBe(-1);
  });
});
