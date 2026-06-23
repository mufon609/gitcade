import { describe, it, expect } from "vitest";
import { World, Entity, resolveSolids, createDefaultRegistry, type AABB, type MovingBody, type Sprite } from "../src/index.js";
import type { Tilemap } from "../src/schema/scene.js";

/**
 * 1.13.0 — `collider.stepHeight`: the additive X-pass step-up. When a DYNAMIC body runs into a solid
 * whose top is a small lip (`0 < foot − top ≤ stepHeight`) with clear headroom, the resolver RAISES it
 * onto the lip and keeps its sideways velocity instead of walling it dead. It exists to clear the
 * sub-pixel seam a 45° ramp leaves where it tops out FLUSH with a same-row solid: the slope pass rests
 * the foot ≈ half a collider-width below the ledge top, which the solid pass would otherwise read as a
 * wall (the "slope-exit jam"). `stepHeight = 0` (every body that doesn't opt in) is byte-identical to
 * the pre-step resolver — covered here as the baseline that STILL jams.
 *
 * Pins, primitive (`resolveSolids`) then integrated (`resolveBodies` over a real ramp→ledge tilemap):
 *  - a small lip is stepped (both X directions), velocity preserved, no wall contact;
 *  - `stepHeight = 0` jams the same lip (unchanged baseline);
 *  - a lip TALLER than `stepHeight` is never stepped (a real wall still walls);
 *  - a blocked headroom (overhang above the lip) cancels the step;
 *  - a body climbs a flush ramp→ledge seam smoothly BOTH directions, while a `stepHeight = 0` body
 *    jams at that exact seam.
 */
const DT = 1 / 60;
const NONE: Sprite = { kind: "none" };

function body(init: Partial<MovingBody>): MovingBody {
  return { x: 0, y: 0, w: 16, h: 16, vx: 0, vy: 0, ...init };
}

describe("resolveSolids — step-up onto a small lip (collider.stepHeight)", () => {
  it("steps a body UP onto a small lip moving right (velocity kept, no wall)", () => {
    // foot at 108 is an 8px lip below the solid top (100); horizontal penetration (4) is shallower,
    // so the X pass reads it as a WALL — exactly the case step-up converts to a climb.
    const solid: AABB = { x: 100, y: 100, w: 32, h: 32 };
    const b = body({ x: 88, y: 92, vx: 600 });
    const c = resolveSolids(b, [solid], DT, { stepHeight: 10 });
    expect(b.y).toBe(84); // raised so the foot (now 100) rests on the lip top
    expect(b.x).toBe(88); // x untouched — the body keeps moving, not pushed back
    expect(b.vx).toBe(600); // horizontal velocity preserved (NOT zeroed)
    expect(c.onWallR).toBe(false);
  });

  it("the SAME lip JAMS a body with stepHeight 0 (the unchanged baseline)", () => {
    const solid: AABB = { x: 100, y: 100, w: 32, h: 32 };
    const b = body({ x: 88, y: 92, vx: 600 });
    const c = resolveSolids(b, [solid], DT); // no opts ⇒ stepHeight 0
    expect(b.x).toBe(84); // walled flush against the solid's left face
    expect(b.vx).toBe(0); // stopped dead
    expect(b.y).toBe(92); // never raised
    expect(c.onWallR).toBe(true);
  });

  it("steps a body UP onto a small lip moving left (symmetric, no wall)", () => {
    const solid: AABB = { x: 0, y: 100, w: 32, h: 32 }; // right face at 32
    const b = body({ x: 28, y: 92, vx: -600 }); // left edge 28 → 4px into the solid; foot 108 = 8px lip
    const c = resolveSolids(b, [solid], DT, { stepHeight: 10 });
    expect(b.y).toBe(84);
    expect(b.x).toBe(28);
    expect(b.vx).toBe(-600);
    expect(c.onWallL).toBe(false);
  });

  it("does NOT step a lip TALLER than stepHeight (a real wall still walls)", () => {
    const solid: AABB = { x: 100, y: 100, w: 32, h: 48 };
    const b = body({ x: 85, y: 104, vx: 600 }); // foot 120 = a 20px lip, > stepHeight 10
    const c = resolveSolids(b, [solid], DT, { stepHeight: 10 });
    expect(c.onWallR).toBe(true);
    expect(b.x).toBe(84); // walled, not stepped
    expect(b.vx).toBe(0);
    expect(b.y).toBe(104);
  });

  it("does NOT step when the raised position has no headroom (an overhang cancels the step)", () => {
    const lip: AABB = { x: 100, y: 100, w: 32, h: 32 }; // 8px lip below the foot
    const overhang: AABB = { x: 100, y: 70, w: 32, h: 20 }; // a solid at [70,90] — above the lip
    const b = body({ x: 85, y: 92, vx: 600 }); // stepping up to y=84 ([84,100]) would hit the overhang
    const c = resolveSolids(b, [lip, overhang], DT, { stepHeight: 10 });
    expect(c.onWallR).toBe(true); // headroom blocked ⇒ walls instead of stepping
    expect(b.vx).toBe(0);
    expect(b.y).toBe(92); // not raised into the overhang
  });

  it("a flush floor-lip (foot exactly at the top) is not a step and is unaffected", () => {
    // foot exactly at the solid top ⇒ lip 0 ⇒ not a wall at all (the body just stands on it).
    const solid: AABB = { x: 100, y: 100, w: 32, h: 32 };
    const b = body({ x: 88, y: 84, vx: 600 }); // foot 100 == solid top
    const c = resolveSolids(b, [solid], DT, { stepHeight: 10 });
    expect(c.onWallR).toBe(false);
    expect(b.vx).toBe(600);
    expect(b.x).toBe(88);
  });
});

// --- integrated: a real ramp→flush-ledge tilemap, the actual slope-exit seam ----------------------
const HILL_PROPS = {
  "0": { solid: true },
  "2": { slopeL: 32, slopeR: 0 }, // slopeL — descends rightward (the down-ramp)
  "3": { slopeL: 0, slopeR: 32 }, // slopeR — ascends rightward (the up-ramp)
};
const LEDGE_TOP_Y = 9 * 32; // 288

/**
 * A flat-topped hill: a 3-cell slopeR ramp up (cols 5–7) topping out FLUSH with a solid ledge (row 9,
 * cols 8–12), then a 3-cell slopeL ramp down (cols 13–15). Solid floor on rows 12–13. The ramp apexes
 * meet the ledge at the same surface row (y=288) — the slope-exit seam stepHeight is built to clear.
 */
function hillMap(): Tilemap {
  const cols = 25;
  const rows = 15;
  const tiles = new Array<number>(cols * rows).fill(-1);
  const set = (c: number, r: number, v: number): void => { tiles[r * cols + c] = v; };
  for (let c = 0; c < cols; c++) { set(c, 12, 0); set(c, 13, 0); } // floor
  set(5, 11, 3); set(6, 10, 3); set(7, 9, 3); // up-ramp slopeR → tops at col 7's right edge (y=288)
  for (let c = 8; c <= 12; c++) set(c, 9, 0); // flush solid ledge
  set(13, 9, 2); set(14, 10, 2); set(15, 11, 2); // down-ramp slopeL
  return { tileSize: 32, cols, rows, tiles, properties: HILL_PROPS };
}

function makeWorld(): World {
  return new World({ bounds: { width: 100000, height: 100000 }, config: {}, registry: createDefaultRegistry() });
}

function addBody(world: World, x: number, y: number, stepHeight: number): Entity {
  const e = new Entity({ id: "p", x, y, w: 16, h: 16, layer: 0, sprite: NONE });
  e.body.collider = { role: "dynamic", oneWay: false, carriable: false, pushable: false, mass: 1, inset: { x: 0, y: 0 }, ...(stepHeight > 0 ? { stepHeight } : {}) };
  world.add(e);
  return e;
}

function tick(world: World, dt = DT): void {
  world.dt = dt;
  world.frame += 1;
  for (const e of world.entities) {
    e.body.prevX = e.x;
    e.body.prevY = e.y;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  }
  world.resolveBodies();
}

/** Drive `e` horizontally (a constant run speed + a mild downward bias, both re-applied each tick like
 *  a mover would) and report the worst horizontal stall and whether it ever stood on the ledge. */
function drive(world: World, e: Entity, dir: 1 | -1, ticks: number): { maxStall: number; reachedLedge: boolean; finalX: number; finalFoot: number } {
  let maxStall = 0;
  let stall = 0;
  let prevX = e.x;
  let reachedLedge = false;
  for (let i = 0; i < ticks; i++) {
    e.vx = dir * 190; // run speed (matches a real platformer; 3.17px/tick)
    e.vy = 120; // mild downward bias < the run step, so flat ground stays "floor" not "wall"
    tick(world);
    const foot = e.y + e.h;
    const dx = e.x - prevX;
    if (Math.sign(dx) !== dir && Math.abs(dx) < 0.5) stall++;
    else { maxStall = Math.max(maxStall, stall); stall = 0; }
    if (Math.abs(foot - LEDGE_TOP_Y) < 3 && e.x >= 256 && e.x <= 416) reachedLedge = true; // standing on the ledge
    prevX = e.x;
  }
  return { maxStall: Math.max(maxStall, stall), reachedLedge, finalX: e.x, finalFoot: e.y + e.h };
}

describe("resolveBodies — step-up clears a flush ramp→ledge seam (both directions)", () => {
  it("climbs RIGHT up the ramp onto the flush ledge with NO jam (stepHeight 10)", () => {
    const world = makeWorld();
    world.tilemap = hillMap();
    const e = addBody(world, 64, 368, 10); // on the floor left of the ramp (col 2)
    const r = drive(world, e, 1, 130);
    expect(r.reachedLedge).toBe(true); // got onto the ledge — the seam did not stop it
    expect(r.maxStall).toBeLessThan(5); // no multi-tick horizontal stall (a jam is dozens)
    expect(r.finalX).toBeGreaterThan(256); // advanced past the seam
  });

  it("climbs LEFT up the down-ramp onto the flush ledge with NO jam (symmetric step-up)", () => {
    const world = makeWorld();
    world.tilemap = hillMap();
    const e = addBody(world, 17 * 32, 368, 10); // on the floor right of the down-ramp (col 17)
    const r = drive(world, e, -1, 130);
    expect(r.reachedLedge).toBe(true);
    expect(r.maxStall).toBeLessThan(5);
    expect(r.finalX).toBeLessThan(416); // climbed left onto/past the ledge
  });

  it("a stepHeight 0 body JAMS at the same seam (the baseline the fix corrects)", () => {
    const world = makeWorld();
    world.tilemap = hillMap();
    const e = addBody(world, 64, 368, 0);
    const r = drive(world, e, 1, 130);
    expect(r.reachedLedge).toBe(false); // never makes it onto the ledge
    expect(r.maxStall).toBeGreaterThan(30); // wedged at the slope-exit seam, vx zeroed every tick
  });
});
