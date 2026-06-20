import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity } from "./helpers.js";
import { tween } from "../src/behaviors/tween.js";

const DT = 1 / 60;

/**
 * The tween primitive. Animates one numeric entity
 * property to a target over a duration with an easing curve; loop none/loop/pingpong.
 * Pure per-tick math off dt → deterministic.
 */

/** Run `tween` for `n` ticks with fixed params. */
function run(e: ReturnType<typeof makeEntity>, world: ReturnType<typeof makeWorld>, params: Record<string, unknown>, n: number) {
  for (let i = 0; i < n; i++) tween(e, world, params, DT);
}

describe("tween — basic progression + from capture", () => {
  it("linearly interpolates opacity from its current value to `to`", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" }); // opacity defaults to 1
    run(e, world, { property: "opacity", to: 0, duration: 1 }, 30); // half the duration
    expect(e.opacity).toBeCloseTo(0.5, 5); // captured from = 1, linear midpoint
  });

  it("reaches `to` exactly at the end and holds (loop:none)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "opacity", to: 0, duration: 1 }, 120); // 2× duration
    expect(e.opacity).toBe(0); // held at the target
  });

  it("an explicit `from` overrides the captured current value", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "opacity", from: 0.2, to: 0.8, duration: 1 }, 30);
    expect(e.opacity).toBeCloseTo(0.5, 5); // 0.2 + 0.6 * 0.5
  });

  it("`scale` drives both scaleX and scaleY", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "scale", from: 1, to: 2, duration: 1 }, 60);
    expect(e.scaleX).toBeCloseTo(2, 5);
    expect(e.scaleY).toBeCloseTo(2, 5);
  });

  it("clamps opacity into [0,1] even when `to` is out of range", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "opacity", from: 1, to: 2, duration: 1 }, 60);
    expect(e.opacity).toBe(1); // 2 clamped
  });
});

describe("tween — loop modes", () => {
  it("loop wraps back to `from` and keeps cycling", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "opacity", from: 0, to: 1, duration: 1, loop: "loop" }, 90); // 1.5 cycles
    expect(e.opacity).toBeCloseTo(0.5, 5); // (1.5 % 1) = 0.5 into the second cycle
  });

  it("pingpong returns to `from` after a full there-and-back", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "opacity", from: 0, to: 1, duration: 1, loop: "pingpong" }, 120); // to and back
    expect(e.opacity).toBeCloseTo(0, 5);
  });

  it("pingpong is at the target at the half-way (one duration in)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "opacity", from: 0, to: 1, duration: 1, loop: "pingpong" }, 60);
    expect(e.opacity).toBeCloseTo(1, 5);
  });
});

describe("tween — delay, easing, namespacing", () => {
  it("holds at `from` until the delay elapses", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "opacity", from: 1, to: 0, duration: 1, delay: 0.5 }, 15); // 0.25s < delay
    expect(e.opacity).toBe(1); // still held at from
    run(e, world, { property: "opacity", from: 1, to: 0, duration: 1, delay: 0.5 }, 30); // total 0.75s
    expect(e.opacity).toBeCloseTo(0.75, 5); // 0.25s past the delay → 25% of the way
  });

  it("out-back overshoots past the target before settling", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    run(e, world, { property: "scale", from: 0, to: 1, duration: 1, easing: "out-back" }, 48); // ~0.8 in
    expect(e.scaleX).toBeGreaterThan(1); // overshoot beyond the target
  });

  it("independent tweens of different properties coexist (state namespaced per property)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    for (let i = 0; i < 60; i++) {
      tween(e, world, { property: "x", to: 100, duration: 1 }, DT);
      tween(e, world, { property: "opacity", to: 0, duration: 1 }, DT);
    }
    expect(e.x).toBeCloseTo(100, 5);
    expect(e.opacity).toBeCloseTo(0, 5);
  });
});
