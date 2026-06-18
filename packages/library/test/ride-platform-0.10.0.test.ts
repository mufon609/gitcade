import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity } from "./helpers.js";
import { ridePlatform } from "../src/behaviors/ride-platform.js";

/**
 * 0.10.0 — ride-platform (INDIE-ROADMAP two-body CARRY half): a rider resting on a moving
 * solid inherits its per-tick world delta. Horizontal carry always; descending carry only
 * (upward is the solid push-out's job); never while the rider is rising.
 */

/** A carrier that MOVED this tick: set its pre-tick position, then its current position. */
function carrier(world: ReturnType<typeof makeWorld>, from: { x: number; y: number }, to: { x: number; y: number }) {
  const c = makeEntity(world, { id: "carrier", x: to.x, y: to.y, w: 96, h: 16, tags: ["solid", "carrier"] });
  c.prevX = from.x;
  c.prevY = from.y;
  return c;
}

describe("ride-platform — carry", () => {
  it("inherits a carrier's horizontal delta when resting on its (pre-tick) top", () => {
    const world = makeWorld();
    carrier(world, { x: 80, y: 200 }, { x: 100, y: 200 }); // moved +20 right
    const rider = makeEntity(world, { id: "p", x: 120, y: 184, w: 16, h: 16 }); // bottom 200 == carrier prev top
    rider.vy = 0;
    ridePlatform(rider, world, { carryTag: "carrier" }, 1 / 60);
    expect(rider.x).toBe(140); // carried +20
    expect(rider.y).toBe(184); // no vertical change
  });

  it("follows a DESCENDING carrier down (descending carry)", () => {
    const world = makeWorld();
    carrier(world, { x: 100, y: 200 }, { x: 100, y: 240 }); // dropped +40
    const rider = makeEntity(world, { id: "p", x: 120, y: 184, w: 16, h: 16 }); // bottom 200
    rider.vy = 0;
    ridePlatform(rider, world, { carryTag: "carrier" }, 1 / 60);
    expect(rider.y).toBe(224); // +40 down with the platform
  });

  it("does NOT pull the rider up on a RISING carrier (push-out handles upward)", () => {
    const world = makeWorld();
    carrier(world, { x: 100, y: 200 }, { x: 100, y: 160 }); // rose 40
    const rider = makeEntity(world, { id: "p", x: 120, y: 184, w: 16, h: 16 }); // bottom 200
    rider.vy = 0;
    ridePlatform(rider, world, { carryTag: "carrier" }, 1 / 60);
    expect(rider.y).toBe(184); // unchanged — upward carry is the resolver's job
  });

  it("is skipped while the rider is rising (vy < 0)", () => {
    const world = makeWorld();
    carrier(world, { x: 80, y: 200 }, { x: 120, y: 200 }); // moved +40
    const rider = makeEntity(world, { id: "p", x: 120, y: 184, w: 16, h: 16 });
    rider.vy = -50; // jumping
    ridePlatform(rider, world, { carryTag: "carrier" }, 1 / 60);
    expect(rider.x).toBe(120); // not carried mid-jump
  });

  it("does not carry when the rider is not resting on the carrier's top", () => {
    const world = makeWorld();
    carrier(world, { x: 80, y: 200 }, { x: 120, y: 200 });
    const rider = makeEntity(world, { id: "p", x: 120, y: 100, w: 16, h: 16 }); // bottom 116, far above top 200
    rider.vy = 0;
    ridePlatform(rider, world, { carryTag: "carrier" }, 1 / 60);
    expect(rider.x).toBe(120); // not in contact → no carry
  });

  it("does not carry without horizontal overlap", () => {
    const world = makeWorld();
    carrier(world, { x: 80, y: 200 }, { x: 120, y: 200 }); // carrier now x 120..216
    const rider = makeEntity(world, { id: "p", x: 0, y: 184, w: 16, h: 16 }); // x 0..16, no overlap
    rider.vy = 0;
    ridePlatform(rider, world, { carryTag: "carrier" }, 1 / 60);
    expect(rider.x).toBe(0);
  });
});
