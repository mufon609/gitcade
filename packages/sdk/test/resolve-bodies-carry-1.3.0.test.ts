import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, type Sprite } from "../src/index.js";
import type { ColliderComponent } from "../src/runtime/entity.js";

/**
 * 1.3.0 — the CARRY step of the resolution phase (`World.resolveBodies` step 1). A dynamic that
 * rested on a `carriable` solid at tick start inherits the carrier's this-tick displacement BEFORE
 * the push-out, so it rides a sliding/sinking platform with no lag and can still walk while carried.
 * Replaces the retired `ride-platform` behavior. Pins: rigid horizontal ride, walk-while-carried,
 * descending follow (no lag), rising push-out, the not-rising / not-resting / not-carriable gates.
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

/** One tick: snapshot prev positions, integrate every body's velocity (carrier moves via its vx/vy), then resolve. */
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

describe("resolveBodies — carry", () => {
  it("rides a horizontally-moving carrier rigidly (inherits its dx, x-offset locked, grounded)", () => {
    const world = makeWorld();
    const carrier = addCollider(world, "lift", 100, 200, 120, 16, { role: "solid", carriable: true }, { vx: 600 });
    const rider = addCollider(world, "p", 140, 180, 20, 20, { role: "dynamic" }); // bottom 200 = carrier top
    const offset0 = rider.x - carrier.x;
    for (let i = 0; i < 10; i++) {
      rider.vy = 300; // gravity stand-in so the push-out keeps re-grounding it
      tick(world);
    }
    expect(carrier.x).toBeGreaterThan(140); // the carrier actually moved
    expect(rider.x - carrier.x).toBeCloseTo(offset0, 6); // carried with no horizontal drift
    expect(rider.y).toBe(carrier.y - rider.h); // still resting on the carrier top
    expect(rider.body.contacts.onGround).toBe(true);
  });

  it("lets the rider WALK while carried (own vx composes with the carrier's dx)", () => {
    const world = makeWorld();
    const carrier = addCollider(world, "lift", 100, 200, 200, 16, { role: "solid", carriable: true }, { vx: 600 });
    const rider = addCollider(world, "p", 140, 180, 20, 20, { role: "dynamic" });
    const rel0 = rider.x - carrier.x;
    for (let i = 0; i < 10; i++) {
      rider.vx = 300; // walk right relative to the platform
      rider.vy = 300;
      tick(world);
    }
    expect(rider.x - carrier.x).toBeGreaterThan(rel0 + 30); // moved right ON the moving platform
    expect(rider.body.contacts.onGround).toBe(true); // never fell off
  });

  it("follows a DESCENDING carrier down with no lag (glued to its top)", () => {
    const world = makeWorld();
    const carrier = addCollider(world, "lift", 100, 200, 120, 16, { role: "solid", carriable: true }, { vy: 480 }); // sinking 8px/tick
    const rider = addCollider(world, "p", 140, 180, 20, 20, { role: "dynamic" });
    let maxGap = 0;
    for (let i = 0; i < 30; i++) {
      rider.vy = 300; // gravity stand-in (slower than the carrier's descent)
      tick(world);
      maxGap = Math.max(maxGap, Math.abs(rider.y - (carrier.y - rider.h)));
    }
    expect(carrier.y).toBeGreaterThan(300); // descended a long way
    expect(maxGap).toBeLessThan(0.001); // tracked the top every tick — no one-tick lag
  });

  it("is pushed UP by a RISING carrier via the push-out (not the carry dy)", () => {
    const world = makeWorld();
    const carrier = addCollider(world, "lift", 100, 300, 120, 16, { role: "solid", carriable: true }, { vy: -300 }); // rising 5px/tick
    const rider = addCollider(world, "p", 140, 280, 20, 20, { role: "dynamic" }); // bottom 300 = carrier top
    for (let i = 0; i < 20; i++) {
      rider.vy = 300; // gravity; the rising carrier overrides it via push-out
      tick(world);
      expect(rider.y).toBe(carrier.y - rider.h); // glued to the rising top
    }
    expect(carrier.y).toBeLessThan(300); // the carrier rose
  });

  it("does NOT carry a rising rider (vy < 0 gate — leaves the platform on a jump)", () => {
    const world = makeWorld();
    const carrier = addCollider(world, "lift", 100, 200, 120, 16, { role: "solid", carriable: true }, { vx: 600 });
    const rider = addCollider(world, "p", 140, 180, 20, 20, { role: "dynamic" });
    const rel0 = rider.x - carrier.x;
    rider.vy = -400; // jumping
    tick(world);
    rider.vy = -400;
    tick(world);
    expect(rider.x - carrier.x).not.toBeCloseTo(rel0, 1); // not locked to the (still-moving) carrier
  });

  it("does NOT carry off a NON-carriable solid (a plain blocker doesn't move its rider)", () => {
    const world = makeWorld();
    const carrier = addCollider(world, "block", 100, 200, 120, 16, { role: "solid", carriable: false }, { vx: 600 });
    const rider = addCollider(world, "p", 140, 180, 20, 20, { role: "dynamic" });
    const x0 = rider.x;
    for (let i = 0; i < 5; i++) {
      rider.vy = 300;
      tick(world);
    }
    expect(rider.x).toBe(x0); // stayed put (vx 0, not carried) while the block slid out from under
    expect(carrier.x).toBeGreaterThan(140);
  });

  it("does NOT carry a rider that was not resting on the carrier (feet-probe fails)", () => {
    const world = makeWorld();
    const carrier = addCollider(world, "lift", 100, 200, 120, 16, { role: "solid", carriable: true }, { vx: 600 });
    const flyer = addCollider(world, "p", 140, 120, 20, 20, { role: "dynamic" }); // bottom 140, far above the carrier top 200
    const x0 = flyer.x;
    flyer.vy = 0;
    tick(world);
    expect(flyer.x).toBe(x0); // not standing on it ⇒ not carried
  });
});
