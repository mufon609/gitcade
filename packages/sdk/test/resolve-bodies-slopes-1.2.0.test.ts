import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, type Sprite } from "../src/index.js";
import type { ColliderComponent } from "../src/runtime/entity.js";
import type { Tilemap } from "../src/schema/scene.js";

/**
 * 1.2.0 — the SLOPE second pass of the resolution phase (`World.resolveBodies` step 2b). After the
 * solid AABB push-out, the phase rests a dynamic body's bottom on any floor-slope tile under it
 * (the `slopeL`/`slopeR` props), absorbing the slope half of the old `tilemap-collide`. Pins: rest
 * on a ramp, downhill-stick (walk down without launching), a rising body passing up through, the
 * no-slope-cell no-op, and slope + collider `inset`.
 */
const NONE: Sprite = { kind: "none" };
const DT = 1 / 60;

function makeWorld(): World {
  return new World({ bounds: { width: 100000, height: 100000 }, config: {}, registry: createDefaultRegistry() });
}

function addCollider(
  world: World,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  collider: Partial<ColliderComponent> & { role: "dynamic" | "solid" },
  vel: { vx?: number; vy?: number } = {},
): Entity {
  const e = new Entity({ id, x, y, w, h, layer: 0, sprite: NONE });
  e.vx = vel.vx ?? 0;
  e.vy = vel.vy ?? 0;
  e.body.collider = { role: collider.role, oneWay: collider.oneWay ?? false, inset: collider.inset ?? { x: 0, y: 0 } };
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

const SLOPE_PROPS = {
  "2": { slopeL: 0, slopeR: 32 }, // ascending L→R
  "3": { slopeL: 32, slopeR: 0 }, // descending L→R
};

/** A 32px grid with single ascending floor-slope cells at `(col,row)` (no continuity needed). */
function slopeMap(row: number, upCols: number[]): Tilemap {
  const cols = 25;
  const rows = 15;
  const tiles = new Array<number>(cols * rows).fill(-1);
  for (const c of upCols) tiles[row * cols + c] = 2;
  return { tileSize: 32, cols, rows, tiles, properties: SLOPE_PROPS };
}

/**
 * A continuous DESCENDING 45° ramp: a diagonal staircase of descending cells `(startCol+i,
 * startRow+i)`. Each cell drops a full 32px over its 32px width, and its right-edge surface height
 * meets the next cell's left edge — so the cells tile into one seamless ramp (a single ROW of
 * descending cells would instead make a 32px sawtooth).
 */
function downRamp(startCol: number, startRow: number, len: number): Tilemap {
  const cols = 25;
  const rows = 15;
  const tiles = new Array<number>(cols * rows).fill(-1);
  for (let i = 0; i < len; i++) {
    const c = startCol + i;
    const r = startRow + i;
    if (c < cols && r < rows) tiles[r * cols + c] = 3;
  }
  return { tileSize: 32, cols, rows, tiles, properties: SLOPE_PROPS };
}

describe("resolveBodies — slope pass", () => {
  it("rests a falling body on the ramp surface under its center (onGround)", () => {
    const world = makeWorld();
    world.tilemap = slopeMap(10, [5]); // ascending cell at col5 (x160..192), row10 (y320..352)
    // Center over x=176 ⇒ t=0.5 ⇒ surface height 16 ⇒ surfaceY = 320 + 32 − 16 = 336.
    const p = addCollider(world, "p", 166, 280, 20, 20, { role: "dynamic" }, { vy: 3000 });
    tick(world);
    expect(p.y).toBe(316); // surfaceY 336 − h 20
    expect(p.body.contacts.onGround).toBe(true);
    expect(p.vy).toBe(0);
  });

  it("a RISING body passes up through a floor slope (no underside, not snapped)", () => {
    const world = makeWorld();
    world.tilemap = slopeMap(10, [5]);
    const p = addCollider(world, "p", 166, 360, 20, 20, { role: "dynamic" }, { vy: -3000 }); // jumping up
    tick(world);
    expect(p.body.contacts.onGround).toBe(false);
    expect(p.y).toBeLessThan(360); // rose freely
  });

  it("no-ops when no slope cell is under the body (slope pass skipped)", () => {
    const world = makeWorld();
    world.tilemap = slopeMap(10, [5]); // ramp far away at col5
    const p = addCollider(world, "p", 600, 280, 20, 20, { role: "dynamic" }, { vy: 3000 }); // x≈600, no cell under
    tick(world);
    expect(p.body.contacts.onGround).toBe(false);
    expect(p.y).toBe(330); // just the integrated fall (280 + 50), untouched by any pass
  });

  it("sticks to a DESCENDING ramp while walking down it — grounded, no launch (downhill-stick)", () => {
    const world = makeWorld();
    world.tilemap = downRamp(5, 5, 10); // continuous descending 45° ramp, cells (5,5)…(14,14)
    // Start resting on cell0 (col5, center x176 → surface height 16 → surfaceY 176 → rest y 156).
    const p = addCollider(world, "p", 166, 156, 20, 20, { role: "dynamic" });
    let maxStepUp = 0;
    let groundedTicks = 0;
    let prevY = p.y;
    for (let i = 0; i < 25; i++) {
      p.vx = 600; // a mover re-applies run speed each tick (10px/tick — matches the 45° drop rate)
      p.vy = 200; // mild downward bias (stands in for gravity) so the body seeks the surface
      tick(world);
      if (p.body.contacts.onGround) groundedTicks++;
      maxStepUp = Math.max(maxStepUp, prevY - p.y);
      prevY = p.y;
    }
    expect(groundedTicks).toBeGreaterThan(20); // stayed on the ramp nearly every tick
    expect(p.y).toBeGreaterThan(156); // descended (y increased)
    expect(maxStepUp).toBeLessThan(8); // smooth descent, never launched upward
  });

  it("rests the INSET collider box on the ramp, mapped back onto the entity", () => {
    const world = makeWorld();
    world.tilemap = slopeMap(10, [5]);
    // 40px-wide sprite, 10px inset per side ⇒ a 20px collider; same center (x176) ⇒ same surfaceY 336.
    const p = addCollider(world, "p", 156, 280, 40, 20, { role: "dynamic", inset: { x: 10, y: 0 } }, { vy: 3000 });
    tick(world);
    // Collider bottom rests at surfaceY 336 ⇒ collider y = 316 ⇒ entity y = 316 − inset.y(0) = 316.
    expect(p.y).toBe(316);
    expect(p.body.contacts.onGround).toBe(true);
  });
});
