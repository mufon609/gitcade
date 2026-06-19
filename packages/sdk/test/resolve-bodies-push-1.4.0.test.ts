import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, type Sprite } from "../src/index.js";
import type { ColliderComponent } from "../src/runtime/entity.js";

/**
 * 1.4.0 — the PUSH step of the resolution phase (`World.resolveBodies` step 4 / `resolvePush`). A
 * dynamic that drives into the SIDE of a `pushable` dynamic shoves it horizontally; crates are limited
 * by the solid world and by other crates (chains), and a pusher stops flush against a crate it can't
 * move. Pins: shove a free crate, into a wall, 2-crate chains (free + wall-blocked), mass-split,
 * mass-ratio, the vertical-contact (stand-on) skip, and the non-pushable-pair no-op.
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

/** Horizontal penetration depth (>0 ⇒ overlapping); a bounded relaxation leaves sub-px residue. */
const penX = (a: Entity, b: Entity): number => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);

describe("resolveBodies — push", () => {
  it("shoves a free crate sideways; the pusher advances flush behind it (no overlap)", () => {
    const world = makeWorld();
    const pusher = addCollider(world, "p", 100, 100, 20, 20, { role: "dynamic" }, { vx: 600 });
    const crate = addCollider(world, "c", 120, 100, 40, 20, { role: "dynamic", pushable: true }); // flush at pusher's right
    const cx0 = crate.x;
    for (let i = 0; i < 8; i++) {
      pusher.vx = 600;
      tick(world);
    }
    expect(crate.x).toBeGreaterThan(cx0 + 40); // crate was shoved a long way right
    expect(overlaps(pusher, crate)).toBe(false); // pusher never penetrates the crate
    expect(pusher.x + pusher.w).toBeCloseTo(crate.x, 4); // flush behind it
  });

  it("stops a pusher flush behind a crate shoved into a wall (crate at wall, no overlap)", () => {
    const world = makeWorld();
    addCollider(world, "wall", 300, 0, 20, 200, { role: "solid" });
    const crate = addCollider(world, "c", 250, 100, 40, 20, { role: "dynamic", pushable: true });
    const pusher = addCollider(world, "p", 200, 100, 20, 20, { role: "dynamic" }, { vx: 600 });
    for (let i = 0; i < 12; i++) {
      pusher.vx = 600;
      tick(world);
    }
    expect(crate.x + crate.w).toBeLessThanOrEqual(300.001); // crate flush against the wall, never through
    expect(crate.x + crate.w).toBeGreaterThan(299); // ...and actually reached it
    expect(overlaps(pusher, crate)).toBe(false); // pusher stopped behind the crate
    expect(pusher.x + pusher.w).toBeLessThanOrEqual(crate.x + 0.001);
  });

  it("pushes a 2-crate chain — both crates move, order preserved, no overlaps", () => {
    const world = makeWorld();
    const pusher = addCollider(world, "p", 100, 100, 20, 20, { role: "dynamic" }, { vx: 600 });
    const a = addCollider(world, "a", 120, 100, 30, 20, { role: "dynamic", pushable: true });
    const b = addCollider(world, "b", 155, 100, 30, 20, { role: "dynamic", pushable: true }); // 5px gap after A
    const ax0 = a.x;
    const bx0 = b.x;
    for (let i = 0; i < 12; i++) {
      pusher.vx = 600;
      tick(world);
    }
    expect(a.x).toBeGreaterThan(ax0); // A moved
    expect(b.x).toBeGreaterThan(bx0); // B moved (the chain transmitted)
    expect(pusher.x).toBeLessThan(a.x); // order preserved
    expect(a.x).toBeLessThan(b.x);
    expect(overlaps(pusher, a)).toBe(false);
    expect(overlaps(a, b)).toBe(false);
  });

  it("a wall-blocked 2-crate chain compresses: B at wall, A behind B, pusher behind A", () => {
    const world = makeWorld();
    addCollider(world, "wall", 300, 0, 20, 200, { role: "solid" });
    const b = addCollider(world, "b", 250, 100, 30, 20, { role: "dynamic", pushable: true });
    const a = addCollider(world, "a", 215, 100, 30, 20, { role: "dynamic", pushable: true });
    const pusher = addCollider(world, "p", 180, 100, 20, 20, { role: "dynamic" }, { vx: 600 });
    for (let i = 0; i < 16; i++) {
      pusher.vx = 600;
      tick(world);
    }
    expect(b.x + b.w).toBeLessThanOrEqual(300.5); // B wedged at the wall
    expect(b.x + b.w).toBeGreaterThan(299); // ...and actually reached it
    expect(a.x).toBeLessThan(b.x); // order preserved
    expect(pusher.x).toBeLessThan(a.x);
    expect(penX(a, b)).toBeLessThan(0.5); // A flush behind B (sub-px relaxation residue, not a gap or deep overlap)
    expect(penX(pusher, a)).toBeLessThan(0.5); // pusher flush behind A
  });

  it("mass-split: two equal pushables separate, each moving HALF the overlap", () => {
    const world = makeWorld();
    const a = addCollider(world, "a", 100, 100, 40, 20, { role: "dynamic", pushable: true, mass: 1 });
    const b = addCollider(world, "b", 120, 100, 40, 20, { role: "dynamic", pushable: true, mass: 1 }); // overlap 20
    world.dt = DT;
    world.frame += 1;
    world.resolveBodies(); // no velocity — pure positional separation
    expect(a.x).toBeCloseTo(90, 4); // moved left 10 (half of 20)
    expect(b.x).toBeCloseTo(130, 4); // moved right 10
    expect(overlaps(a, b)).toBe(false);
  });

  it("mass-ratio: the lighter pushable moves more than the heavier", () => {
    const world = makeWorld();
    const light = addCollider(world, "light", 100, 100, 40, 20, { role: "dynamic", pushable: true, mass: 1 });
    const heavy = addCollider(world, "heavy", 120, 100, 40, 20, { role: "dynamic", pushable: true, mass: 3 }); // overlap 20
    world.dt = DT;
    world.frame += 1;
    world.resolveBodies();
    expect(100 - light.x).toBeCloseTo(15, 3); // light moved 15 left
    expect(heavy.x - 120).toBeCloseTo(5, 3); // heavy moved 5 right
    expect(overlaps(light, heavy)).toBe(false);
  });

  it("does NOT treat STANDING on a crate (vertical contact) as a push", () => {
    const world = makeWorld();
    const crate = addCollider(world, "c", 100, 100, 40, 20, { role: "dynamic", pushable: true });
    const rider = addCollider(world, "r", 110, 82, 20, 20, { role: "dynamic" }); // bottom 102 — 2px into the crate top
    const rx0 = rider.x;
    const cx0 = crate.x;
    world.dt = DT;
    world.frame += 1;
    world.resolveBodies();
    expect(rider.x).toBe(rx0); // vertical (min-axis) contact ⇒ no horizontal shove
    expect(crate.x).toBe(cx0);
  });

  it("two NON-pushable dynamics still don't interact, even with a pushable elsewhere", () => {
    const world = makeWorld();
    addCollider(world, "crate", 1000, 100, 20, 20, { role: "dynamic", pushable: true }); // makes the push pass run
    const a = addCollider(world, "a", 100, 100, 40, 40, { role: "dynamic" });
    const b = addCollider(world, "b", 120, 110, 40, 40, { role: "dynamic" }); // overlaps a, neither pushable
    world.dt = DT;
    world.frame += 1;
    world.resolveBodies();
    expect(a.x).toBe(100); // unchanged — non-pushable pair never pushes (inc-1 boundary)
    expect(b.x).toBe(120);
  });
});
