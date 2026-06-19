import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, type Sprite } from "../src/index.js";
import type { ColliderComponent } from "../src/runtime/entity.js";
import type { Tilemap } from "../src/schema/scene.js";

/**
 * 1.7.0 — SWEPT push (`sweptShove`, phase 1 of `World.resolvePush`). Before this, push read the
 * SETTLED-FRAME overlap, so a pusher faster than the crate's width per tick either (a) TUNNELLED clean
 * through the crate (its trailing edge ended past it ⇒ zero overlap ⇒ no shove) or (b) was YANKED
 * backwards by the phase-3 clamp while the crate barely moved (the settled overlap under-read the true
 * penetration). The swept shove measures the pusher's leading-edge overshoot past the crate's near face,
 * so the whole displacement transfers and the pusher ends flush ahead. These pin both failure modes as
 * fixed, plus a high-speed no-tunnel + determinism fuzz.
 */
const NONE: Sprite = { kind: "none" };
const DT = 1 / 60;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  e.body.collider = { role: collider.role, oneWay: collider.oneWay ?? false, carriable: collider.carriable ?? false, pushable: collider.pushable ?? false, mass: collider.mass ?? 1, inset: collider.inset ?? { x: 0, y: 0 } };
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

const overlaps = (a: Entity, b: Entity): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("resolveBodies — swept push (no tunnelling, no backward-yank)", () => {
  it("a pusher faster than the crate width per tick drives the crate the FULL displacement, flush ahead", () => {
    const world = makeWorld();
    // 66.7px/tick > crate width 40; FLUSH start (the old clean-tunnel case).
    const pusher = addCollider(world, "p", 100, 100, 20, 20, { role: "dynamic" }, { vx: 4000 });
    const crate = addCollider(world, "c", 120, 100, 40, 20, { role: "dynamic", pushable: true });
    pusher.vx = 4000;
    tick(world);
    expect(crate.x).toBeGreaterThan(180); // crate carried ~66px forward (NOT untouched)
    expect(overlaps(pusher, crate)).toBe(false); // no tunnel, no penetration
    expect(pusher.x + pusher.w).toBeCloseTo(crate.x, 4); // pusher flush behind the crate
  });

  it("a deep overshoot does NOT yank the pusher backwards — it ends ahead, flush behind the crate", () => {
    const world = makeWorld();
    const pusher = addCollider(world, "p", 100, 100, 20, 20, { role: "dynamic" }, { vx: 4000 });
    const crate = addCollider(world, "c", 130, 100, 40, 20, { role: "dynamic", pushable: true }); // 10px gap
    pusher.vx = 4000;
    tick(world);
    // The pusher integrated to ~166.7; the swept push leaves it AHEAD (near there), not yanked back to ~113.
    expect(pusher.x).toBeGreaterThan(150);
    expect(crate.x - 130).toBeGreaterThan(50); // crate moved ~56px (66 − 10 gap), not ~3px
    expect(overlaps(pusher, crate)).toBe(false);
    expect(pusher.x + pusher.w).toBeCloseTo(crate.x, 4);
  });

  it("a fast pusher shoves a crate into a wall without tunnelling — crate flush at wall, pusher behind", () => {
    const world = makeWorld();
    addCollider(world, "wall", 300, 0, 20, 200, { role: "solid" });
    const crate = addCollider(world, "c", 250, 100, 40, 20, { role: "dynamic", pushable: true });
    const pusher = addCollider(world, "p", 200, 100, 20, 20, { role: "dynamic" }, { vx: 5000 }); // ~83px/tick
    for (let i = 0; i < 6; i++) { pusher.vx = 5000; tick(world); }
    expect(crate.x + crate.w).toBeLessThanOrEqual(300.001); // never through the wall
    expect(crate.x + crate.w).toBeGreaterThan(299); // reached it
    expect(overlaps(pusher, crate)).toBe(false);
    expect(pusher.x + pusher.w).toBeLessThanOrEqual(crate.x + 0.001); // flush behind
  });

  it("a fast pusher never tunnels a free crate behind it (high-speed fuzz, 200 scenes)", () => {
    for (let s = 0; s < 200; s++) {
      const rng = mulberry32(11000 + s);
      const world = makeWorld();
      const pw = 16 + rng() * 24;
      const cw = 16 + rng() * 40;
      const pusher = addCollider(world, "p", 100, 100, pw, 20, { role: "dynamic" }, { vx: 2000 + rng() * 6000 });
      const crate = addCollider(world, "c", 100 + pw + rng() * 30, 100, cw, 20, { role: "dynamic", pushable: true });
      pusher.vx = pusher.vx; // (already set)
      const vx = pusher.vx;
      pusher.vx = vx;
      tick(world);
      // INVARIANT: the pusher must end at or behind the crate's near face — never tunnelled past it.
      expect(pusher.x, `scene ${s}: pusher tunnelled past the crate`).toBeLessThanOrEqual(crate.x + crate.w + 0.01);
      expect(overlaps(pusher, crate), `scene ${s}: penetrating`).toBe(false);
    }
  });

  it("swept push stays replay-deterministic over high-speed scenes (100 scenes)", () => {
    const run = (seed: number): string => {
      const rng = mulberry32(seed);
      const world = makeWorld();
      const wall = 600;
      world.tilemap = (() => {
        const cols = 30, rows = 10;
        const tiles = new Array<number>(cols * rows).fill(-1);
        for (let r = 0; r < rows; r++) tiles[r * cols + (cols - 1)] = 1;
        return { tileSize: 32, cols, rows, tiles, properties: { "1": { solid: true } } } as Tilemap;
      })();
      const n = 2 + Math.floor(rng() * 3);
      const crates: Entity[] = [];
      let x = 200;
      for (let i = 0; i < n; i++) { const w = 24 + Math.floor(rng() * 20); crates.push(addCollider(world, `c${i}`, x, 100, w, 24, { role: "dynamic", pushable: true })); x += w + rng() * 15; }
      const pusher = addCollider(world, "p", 150, 100, 24, 24, { role: "dynamic" });
      const v = 2000 + rng() * 5000;
      for (let f = 0; f < 30; f++) { pusher.vx = v; tick(world); }
      return crates.map((c) => c.x.toFixed(6)).join("|") + `#${pusher.x.toFixed(6)}#${wall}`;
    };
    for (let s = 0; s < 100; s++) expect(run(13000 + s)).toBe(run(13000 + s));
  });
});
