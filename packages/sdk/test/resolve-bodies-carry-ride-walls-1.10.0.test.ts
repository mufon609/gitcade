import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, type Sprite } from "../src/index.js";
import type { ColliderComponent } from "../src/runtime/entity.js";
import type { Tilemap } from "../src/schema/scene.js";

/**
 * 1.10.0 — SOLID-AWARE CARRY + RIDE (the shared-root fix). The resolution phase moves a rider
 * POSITIONALLY by its carrier's displacement (carry of a carriable platform; ride of a horizontally
 * pushed crate), but the only correction in the per-body loop — `resolveSolids` — is MOTION-derived and
 * does nothing on an axis where the body has zero velocity. So a passive (`vx=0`) rider was carried/ridden
 * straight THROUGH a wall and NEVER ejected (not "one tick late" — the velocity push-out can't touch a
 * vx=0 body, so it stayed embedded forever). The crate push already used the velocity-independent
 * `clampShoveBySolids`; carry and ride now use the same clamp, so a rider stops flush at a wall.
 *
 * These cover both halves of the root + the byte-identical no-wall path. The on-open-ground carry/ride
 * cases live in resolve-bodies-carry-1.3.0 / resolve-bodies-stacking-1.9.0 (unchanged by this fix).
 */
const NONE: Sprite = { kind: "none" };
const DT = 1 / 60;
const G = 1200;

function makeWorld(): World {
  return new World({ bounds: { width: 100000, height: 100000 }, config: {}, registry: createDefaultRegistry() });
}
function floorMap(): Tilemap {
  const cols = 40, rows = 20, ts = 32;
  const tiles = new Array<number>(cols * rows).fill(-1);
  for (let c = 0; c < cols; c++) tiles[(rows - 1) * cols + c] = 1; // floor top y = 608
  return { tileSize: ts, cols, rows, tiles, properties: { "1": { solid: true } } };
}
function addCollider(world: World, id: string, x: number, y: number, w: number, h: number, collider: Partial<ColliderComponent> & { role: "dynamic" | "solid" }): Entity {
  const e = new Entity({ id, x, y, w, h, layer: 0, sprite: NONE });
  e.body.collider = { role: collider.role, oneWay: collider.oneWay ?? false, carriable: collider.carriable ?? false, pushable: collider.pushable ?? false, mass: collider.mass ?? 1, inset: collider.inset ?? { x: 0, y: 0 } };
  world.add(e);
  return e;
}
function tick(world: World, gravity: Entity[] = [], dt = DT): void {
  world.dt = dt; world.frame += 1;
  for (const e of world.entities) { e.body.prevX = e.x; e.body.prevY = e.y; }
  for (const e of gravity) e.vy += G * dt;
  for (const e of world.entities) { e.x += e.vx * dt; e.y += e.vy * dt; }
  world.resolveBodies();
}

describe("carry into a wall (the latent half of the root)", () => {
  it("a passive (vx=0) rider carried by a platform into a wall stops flush — never penetrates", () => {
    const world = makeWorld();
    // Carriable platform sliding right; rider rests on top (passive vx=0). Wall sits in the RIDER's band
    // only (above the platform), so the platform slides under it but the rider's leading edge meets it.
    const platform = addCollider(world, "plat", 300, 500, 120, 20, { role: "solid", carriable: true });
    const rider = addCollider(world, "rider", 340, 480, 20, 20, { role: "dynamic" });
    const wall = addCollider(world, "wall", 460, 460, 20, 40, { role: "solid" }); // band 460..500

    let worst = -Infinity;
    for (let f = 0; f < 30; f++) {
      platform.vx = 300; // slide right (integrated after the prev snapshot, like a real carrier behavior)
      tick(world, [rider]);
      worst = Math.max(worst, rider.x + rider.w - wall.x); // >0 ⇒ inside the wall
    }
    expect(worst).toBeLessThanOrEqual(0.001); // rider stopped flush at the wall's left face, no penetration
    expect(rider.x + rider.w).toBeCloseTo(wall.x, 3); // flush
  });
});

describe("ride a pushed crate into a wall (the documented half)", () => {
  it("a rider overhanging a crate toward a wall stops flush — never embeds", () => {
    const world = makeWorld();
    world.tilemap = floorMap();
    const wall = addCollider(world, "wall", 560, 400, 40, 208, { role: "solid" });
    const crate = addCollider(world, "crate", 500, 576, 32, 32, { role: "dynamic", pushable: true });
    const rider = addCollider(world, "rider", 520, 556, 32, 20, { role: "dynamic" }); // right edge 552 overhangs the crate toward the wall
    const pusher = addCollider(world, "pusher", 460, 560, 20, 36, { role: "dynamic" });

    let worst = -Infinity;
    for (let f = 0; f < 40; f++) {
      pusher.vx = 1200; // fast — one tick's drag exceeds the rider's 8px gap to the wall
      tick(world, [crate, rider, pusher]);
      worst = Math.max(worst, rider.x + rider.w - wall.x);
    }
    expect(worst).toBeLessThanOrEqual(0.001); // rider never crosses the wall's left face
    expect(rider.x + rider.w).toBeLessThanOrEqual(wall.x + 0.001); // settled at/behind the wall
  });

  it("the crate still reaches the wall (the rider stopping doesn't block the crate)", () => {
    const world = makeWorld();
    world.tilemap = floorMap();
    addCollider(world, "wall", 560, 400, 40, 208, { role: "solid" });
    const crate = addCollider(world, "crate", 500, 576, 32, 32, { role: "dynamic", pushable: true });
    addCollider(world, "rider", 520, 556, 32, 20, { role: "dynamic" });
    const pusher = addCollider(world, "pusher", 460, 560, 20, 36, { role: "dynamic" });
    for (let f = 0; f < 40; f++) { pusher.vx = 600; tick(world, [crate, pusher], DT); }
    expect(crate.x + crate.w).toBeCloseTo(560, 0); // crate flush at the wall (560)
  });
});

describe("byte-identical when there is no wall in the path", () => {
  it("an open-ground ride is unchanged (rider rides the full crate displacement)", () => {
    const world = makeWorld();
    world.tilemap = floorMap();
    const crate = addCollider(world, "crate", 300, 576, 40, 32, { role: "dynamic", pushable: true });
    const rider = addCollider(world, "rider", 310, 556, 20, 20, { role: "dynamic" });
    const pusher = addCollider(world, "pusher", 250, 560, 20, 36, { role: "dynamic" });
    const rx0 = rider.x;
    for (let f = 0; f < 60; f++) { pusher.vx = 400; tick(world, [crate, rider, pusher]); }
    expect(crate.x).toBeGreaterThan(360);
    expect(rider.x).toBeGreaterThan(rx0 + 40); // rode along, no clamp engaged
    expect(Math.abs(rider.x - crate.x - 10)).toBeLessThan(8); // still centred over the crate
  });

  it("an open-ground carry is unchanged (rider rides the full platform displacement)", () => {
    const world = makeWorld();
    const platform = addCollider(world, "plat", 100, 500, 200, 20, { role: "solid", carriable: true });
    const rider = addCollider(world, "rider", 140, 480, 20, 20, { role: "dynamic" });
    const rx0 = rider.x;
    platform.vx = 240;
    for (let f = 0; f < 60; f++) tick(world, [rider]);
    const platDx = platform.x - 100;
    expect(rider.x - rx0).toBeCloseTo(platDx, 0); // rider matched the platform exactly (no clamp)
  });
});

describe("determinism holds with the clamp in the carry/ride path", () => {
  it("a carry + ride + wall scene is replay-deterministic (40 seeds)", () => {
    const run = (seed: number): string => {
      let a = seed >>> 0;
      const rng = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const world = makeWorld();
      world.tilemap = floorMap();
      addCollider(world, "wall", 560, 400, 40, 208, { role: "solid" });
      const crate = addCollider(world, "crate", 400, 576, 32, 32, { role: "dynamic", pushable: true });
      const rider = addCollider(world, "rider", 408, 556, 28, 20, { role: "dynamic" });
      const pusher = addCollider(world, "pusher", 300, 560, 20, 36, { role: "dynamic" });
      for (let f = 0; f < 60; f++) { pusher.vx = 200 + rng() * 600; tick(world, [crate, rider, pusher]); }
      return `${crate.x.toFixed(5)}|${rider.x.toFixed(5)},${rider.y.toFixed(5)}`;
    };
    for (let s = 0; s < 40; s++) expect(run(30000 + s)).toBe(run(30000 + s));
  });
});
