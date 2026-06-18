import { describe, it, expect } from "vitest";
import { resolveSlopes, type SlopeCell, type MovingBody } from "../src/index.js";

/**
 * 0.11.0 — resolveSlopes (INDIE-ROADMAP floor slopes): rest a moving AABB's bottom on a tilemap
 * floor-slope surface sampled at the body's center x. Walk up/down a ramp; stick downhill; pass
 * up through while rising; no-op (byte-identical) when there are no slope cells.
 *
 * Reference ramp: a 45° ascending-right cell (0,0,32,32) with slopeL=0, slopeR=32 → the surface
 * height up from the cell bottom is `sampleX` px, so surfaceY = (cellBottom 32) - sampleX = 32 - x.
 */
const DT = 1 / 60;
const RAMP: SlopeCell = { x: 0, y: 0, w: 32, h: 32, slopeL: 0, slopeR: 32 };

function body(init: Partial<MovingBody>): MovingBody {
  return { x: 0, y: 0, w: 16, h: 16, vx: 0, vy: 0, ...init };
}

describe("resolveSlopes — floor slopes", () => {
  it("rests a falling body's bottom on the ramp surface under its center", () => {
    const b = body({ x: 8, y: 4, vy: 200 }); // center x=16 → surfaceY 16; bottom 20 penetrates
    const c = resolveSlopes(b, [RAMP], DT);
    expect(c.onGround).toBe(true);
    expect(b.y).toBe(0); // surfaceY (16) - h (16)
    expect(b.vy).toBe(0); // downward velocity zeroed
  });

  it("rests higher up the ascending ramp (walking right → lower y)", () => {
    const low = body({ x: 0, y: 30, vy: 200 }); // center 8 → surfaceY 24 → rest y 8
    resolveSlopes(low, [RAMP], DT);
    const high = body({ x: 16, y: 30, vy: 200 }); // center 24 → surfaceY 8 → rest y -8
    resolveSlopes(high, [RAMP], DT);
    expect(high.y).toBeLessThan(low.y); // further up the ramp sits higher (smaller y)
  });

  it("sticks downhill: a body hovering within |vx|*dt of the surface snaps down", () => {
    const b = body({ x: 8, y: -2, vx: 600 }); // center 16 → surfaceY 16; bottom 14, 2px ABOVE
    const c = resolveSlopes(b, [RAMP], DT); // snapDown = min(32, 600/60+1)=11 ≥ 2 → snap
    expect(c.onGround).toBe(true);
    expect(b.y).toBe(0);
  });

  it("does NOT snap a body hovering beyond the stick band (stays airborne)", () => {
    const b = body({ x: 8, y: -20, vx: 0 }); // bottom -4, 20px above surface 16; band = 1
    const c = resolveSlopes(b, [RAMP], DT);
    expect(c.onGround).toBe(false);
    expect(b.y).toBe(-20); // untouched
  });

  it("never snaps a RISING body — a jump passes up through the slope", () => {
    const b = body({ x: 8, y: 4, vy: -100 }); // penetrating but rising
    const c = resolveSlopes(b, [RAMP], DT);
    expect(c.onGround).toBe(false);
    expect(b.y).toBe(4); // untouched
    expect(b.vy).toBe(-100);
  });

  it("no slope under the body's center → no contact, body untouched", () => {
    const b = body({ x: 100, y: 10, vy: 200 }); // center 108, outside the cell (0..32)
    const c = resolveSlopes(b, [RAMP], DT);
    expect(c.onGround).toBe(false);
    expect(b.y).toBe(10);
  });

  it("empty slopeCells ⇒ no contact, body untouched (byte-identity guard)", () => {
    const b = body({ x: 8, y: 4, vy: 200 });
    const c = resolveSlopes(b, [], DT);
    expect(c.onGround).toBe(false);
    expect(b.y).toBe(4);
    expect(b.vy).toBe(200);
  });

  it("a gentle ramp across two cells is seamless (continuous surface at the shared edge)", () => {
    const a: SlopeCell = { x: 0, y: 0, w: 32, h: 32, slopeL: 0, slopeR: 16 };
    const bcell: SlopeCell = { x: 32, y: 0, w: 32, h: 32, slopeL: 16, slopeR: 32 };
    // Two bodies straddling the seam (centers at 30 and 34) should rest ~2px apart, not jump.
    const left = body({ x: 22, y: 30, vy: 200 }); // center 30 (in A)
    resolveSlopes(left, [a, bcell], DT);
    const right = body({ x: 26, y: 30, vy: 200 }); // center 34 (in B)
    resolveSlopes(right, [a, bcell], DT);
    expect(Math.abs(left.y - right.y)).toBeLessThan(3); // continuous, no seam discontinuity
    expect(right.y).toBeLessThan(left.y); // still ascending across the seam
  });
});
