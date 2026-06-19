import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, type Sprite } from "../src/index.js";
import type { ColliderComponent } from "../src/runtime/entity.js";
import type { Tilemap } from "../src/schema/scene.js";

/**
 * 1.9.0 — DYNAMIC-ON-DYNAMIC stacking: a `pushable` crate is now SOLID-TO-DYNAMICS. A body lands and
 * stands on a crate's top (the crate joins each body's push-out as a top-only/`oneWay` solid), and a
 * rider RIDES a crate that moves — whether the crate falls, is carried by a moving platform
 * (transitively), or is shoved horizontally by a pusher. Dynamics resolve in dependency order (a rider
 * after the crate it rests on) so it lands on / rides the crate's SETTLED position. The whole phase
 * collapses to the pre-stacking behavior when no entity is pushable (covered by the other suites).
 */
const NONE: Sprite = { kind: "none" };
const DT = 1 / 60;
const G = 1200;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeWorld(): World {
  return new World({ bounds: { width: 100000, height: 100000 }, config: {}, registry: createDefaultRegistry() });
}
function floorMap(): Tilemap {
  const cols = 40, rows = 20, ts = 32;
  const tiles = new Array<number>(cols * rows).fill(-1);
  for (let c = 0; c < cols; c++) tiles[(rows - 1) * cols + c] = 1; // floor top y = 19*32 = 608
  return { tileSize: ts, cols, rows, tiles, properties: { "1": { solid: true } } };
}
function addCollider(world: World, id: string, x: number, y: number, w: number, h: number, collider: Partial<ColliderComponent> & { role: "dynamic" | "solid" }): Entity {
  const e = new Entity({ id, x, y, w, h, layer: 0, sprite: NONE });
  e.body.collider = { role: collider.role, oneWay: collider.oneWay ?? false, carriable: collider.carriable ?? false, pushable: collider.pushable ?? false, mass: collider.mass ?? 1, inset: collider.inset ?? { x: 0, y: 0 } };
  world.add(e);
  return e;
}
/** One tick: snapshot prev, apply gravity to `gravity`, integrate every body, run the phase. */
function tick(world: World, gravity: Entity[] = [], dt = DT): void {
  world.dt = dt;
  world.frame += 1;
  for (const e of world.entities) { e.body.prevX = e.x; e.body.prevY = e.y; }
  for (const e of gravity) e.vy += G * dt;
  for (const e of world.entities) { e.x += e.vx * dt; e.y += e.vy * dt; }
  world.resolveBodies();
}

describe("stacking — stand on a crate", () => {
  it("a falling dynamic lands on a crate's TOP and rests there (does not sink through)", () => {
    const world = makeWorld();
    world.tilemap = floorMap();
    const crate = addCollider(world, "crate", 100, 576, 32, 32, { role: "dynamic", pushable: true });
    const rider = addCollider(world, "rider", 104, 400, 20, 20, { role: "dynamic" });
    for (let f = 0; f < 120; f++) tick(world, [crate, rider]);
    expect(crate.y).toBe(576); // crate rests on the floor (608 − 32)
    expect(rider.y).toBeCloseTo(556, 3); // on the crate top (576 − 20), NOT sunk to the floor (588)
    expect(rider.body.contacts.onGround).toBe(true);
  });

  it("a rider jumps UP through a crate from below (top-only/oneWay — no head-bonk)", () => {
    const world = makeWorld();
    const crate = addCollider(world, "crate", 100, 500, 40, 20, { role: "dynamic", pushable: true }); // floating (no gravity here)
    const rider = addCollider(world, "rider", 110, 540, 16, 16, { role: "dynamic" });
    rider.vy = -600; // rising
    for (let f = 0; f < 10; f++) tick(world); // no gravity ⇒ keeps rising
    expect(rider.y).toBeLessThan(500); // rose past the crate, never bonked its underside
    expect(rider.body.contacts.onCeiling).toBe(false);
  });

  it("down+jump (drop-through window) drops a rider off the crate it stands on", () => {
    const world = makeWorld();
    world.tilemap = floorMap();
    const crate = addCollider(world, "crate", 100, 576, 40, 32, { role: "dynamic", pushable: true });
    const rider = addCollider(world, "rider", 110, 556, 16, 16, { role: "dynamic" }); // standing on the crate
    for (let f = 0; f < 5; f++) tick(world, [crate, rider]); // settle
    expect(rider.y).toBeCloseTo(560, 1); // on the crate top (576 − 16)
    rider.body.dropThrough = 1; // open the window
    for (let f = 0; f < 30; f++) tick(world, [crate, rider]);
    expect(rider.y).toBeGreaterThan(576); // fell through the crate, down toward the floor
  });
});

describe("stacking — stacked crates", () => {
  it("crate B rests on crate A's top; both stable on the floor", () => {
    const world = makeWorld();
    world.tilemap = floorMap();
    const a = addCollider(world, "a", 100, 576, 32, 32, { role: "dynamic", pushable: true });
    const b = addCollider(world, "b", 102, 300, 32, 32, { role: "dynamic", pushable: true });
    for (let f = 0; f < 150; f++) tick(world, [a, b]);
    expect(a.y).toBe(576);
    expect(b.y).toBeCloseTo(544, 3); // on A's top (576 − 32)
  });
});

describe("stacking — ride a moving crate", () => {
  it("a rider rides a crate shoved horizontally by a pusher (same tick, no lag)", () => {
    const world = makeWorld();
    world.tilemap = floorMap();
    const crate = addCollider(world, "crate", 300, 576, 40, 32, { role: "dynamic", pushable: true });
    const rider = addCollider(world, "rider", 310, 556, 20, 20, { role: "dynamic" }); // standing on the crate
    const pusher = addCollider(world, "pusher", 250, 560, 20, 36, { role: "dynamic" }); // shoves the crate from the left
    const rx0 = rider.x;
    for (let f = 0; f < 60; f++) { pusher.vx = 400; tick(world, [crate, rider, pusher]); }
    expect(crate.x).toBeGreaterThan(360); // crate pushed well right
    expect(rider.x).toBeGreaterThan(rx0 + 40); // rider rode along
    expect(Math.abs(rider.x - crate.x - 10)).toBeLessThan(8); // stayed centred over the crate
    expect(rider.y).toBeCloseTo(556, 2); // stayed on the crate top
  });

  it("transitive: a rider on a crate on a horizontally-moving carriable platform rides the whole stack", () => {
    const world = makeWorld();
    const platform = addCollider(world, "plat", 100, 500, 200, 20, { role: "solid", carriable: true });
    const crate = addCollider(world, "crate", 140, 468, 32, 32, { role: "dynamic", pushable: true }); // on the platform
    const rider = addCollider(world, "rider", 146, 448, 20, 20, { role: "dynamic" }); // on the crate
    const cx0 = crate.x, rx0 = rider.x;
    platform.vx = 300; // slides right (integrated after the prev snapshot, like a real carrier behavior)
    for (let f = 0; f < 60; f++) tick(world, [crate, rider]);
    const platDx = platform.x - 100;
    expect(crate.x - cx0).toBeCloseTo(platDx, 0); // crate rode the platform
    expect(rider.x - rx0).toBeCloseTo(platDx, 0); // rider rode the crate (transitively)
    expect(rider.y).toBeCloseTo(448, 2);
  });
});

describe("stacking — pushing still works (the oneWay crate doesn't block a walker)", () => {
  it("a walker drives into a crate's SIDE and shoves it (not stopped by the stand-on solidity)", () => {
    const world = makeWorld();
    world.tilemap = floorMap();
    const crate = addCollider(world, "crate", 300, 576, 32, 32, { role: "dynamic", pushable: true });
    const walker = addCollider(world, "walker", 250, 584, 24, 24, { role: "dynamic" }); // on the floor, left of the crate
    for (let f = 0; f < 40; f++) { walker.vx = 300; tick(world, [crate, walker]); }
    expect(crate.x).toBeGreaterThan(330); // crate was shoved right (push works through the oneWay solidity)
    expect(walker.x + walker.w).toBeLessThanOrEqual(crate.x + 0.5); // walker flush behind it
  });
});

describe("stacking — determinism", () => {
  it("a stand-on + push + stack scene is replay-deterministic (50 seeds)", () => {
    const run = (seed: number): string => {
      const rng = mulberry32(seed);
      const world = makeWorld();
      world.tilemap = floorMap();
      const crates: Entity[] = [];
      const grav: Entity[] = [];
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) { const c = addCollider(world, `c${i}`, 200 + i * 36, 300 - i * 40, 32, 32, { role: "dynamic", pushable: true }); crates.push(c); grav.push(c); }
      const rider = addCollider(world, "rider", 210, 200, 18, 18, { role: "dynamic" }); grav.push(rider);
      const pusher = addCollider(world, "pusher", 150, 584, 20, 24, { role: "dynamic" }); grav.push(pusher);
      for (let f = 0; f < 80; f++) { pusher.vx = 200 + rng() * 200; tick(world, grav); }
      return crates.map((c) => `${c.x.toFixed(5)},${c.y.toFixed(5)}`).join("|") + `#${rider.x.toFixed(5)},${rider.y.toFixed(5)}`;
    };
    for (let s = 0; s < 50; s++) expect(run(20000 + s)).toBe(run(20000 + s));
  });
});
