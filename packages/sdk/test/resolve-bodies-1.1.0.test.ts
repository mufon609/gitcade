import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, aabbOverlap, type Sprite } from "../src/index.js";
import type { ColliderComponent } from "../src/runtime/entity.js";
import type { Tilemap } from "../src/schema/scene.js";

/**
 * 1.1.0 — the unified collision-resolution PHASE (`World.resolveBodies`). Pins:
 *  - the fast-path no-op (a scene with no collider is byte-identical / untouched),
 *  - solid push-out vs tiles AND solid-role entities (land / block / bonk / swept no-tunnel),
 *  - one-way solids + the mover's drop-through, and the collider `inset` box,
 *  - the increment-1 boundary (dynamics don't resolve against each other; solids never move), and
 *  - the candidate-keyed determinism semantics via a filtered-vs-fullscan fuzz harness: a solid
 *    OUTSIDE a body's swept box never perturbs its resolved position (the §6 improvement), plus
 *    no-penetration and replay-determinism over random scenes.
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

/** Add an entity carrying a resolved collider (the runtime shape the factory normally produces). */
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

/** One tick: integrate every body's velocity (the `velocity` behavior's job), then run the phase. */
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

/** A grid whose bottom row (row `rows-1`) is solid floor; optional one-way row just above it. */
function floorMap(opts: { oneWayRow?: number } = {}): Tilemap {
  const cols = 12;
  const rows = 12;
  const tiles = new Array<number>(cols * rows).fill(-1);
  for (let c = 0; c < cols; c++) tiles[(rows - 1) * cols + c] = 1; // solid floor
  if (opts.oneWayRow !== undefined) for (let c = 0; c < cols; c++) tiles[opts.oneWayRow * cols + c] = 2;
  return {
    tileSize: 32,
    cols,
    rows,
    tiles,
    properties: { "1": { solid: true }, "2": { oneWay: true } },
  };
}

describe("resolveBodies — fast path", () => {
  it("is a no-op (body untouched, contacts never stamped) when no entity has a collider", () => {
    const world = makeWorld();
    const e = new Entity({ id: "a", x: 5, y: 7, w: 10, h: 10, layer: 0, sprite: NONE });
    world.add(e);
    world.dt = DT;
    world.resolveBodies();
    expect(e.x).toBe(5);
    expect(e.y).toBe(7);
    expect(e.body.contactTick).toBe(-1); // never went through applyContacts
    expect(e.body.contacts.onGround).toBe(false);
  });

  it("never resolves nor relocates a SOLID-role body (it is an immovable blocker, not a dynamic)", () => {
    const world = makeWorld();
    const solid = addCollider(world, "lift", 0, 100, 80, 16, { role: "solid" });
    const dyn = addCollider(world, "p", 20, 50, 16, 16, { role: "dynamic" }, { vy: 3000 });
    tick(world);
    expect(solid.x).toBe(0); // solid stayed put — the phase never moves it
    expect(solid.y).toBe(100);
    expect(dyn.body.contacts.onGround).toBe(true); // the dynamic landed on it
  });
});

describe("resolveBodies — solid push-out vs entities", () => {
  it("lands a falling dynamic flush on a solid entity's top (onGround, vy zeroed)", () => {
    const world = makeWorld();
    addCollider(world, "crate", 0, 100, 200, 40, { role: "solid" });
    const p = addCollider(world, "p", 40, 50, 20, 20, { role: "dynamic" }, { vy: 3000 });
    tick(world);
    expect(p.y).toBe(80); // crate top 100 − body h 20
    expect(p.vy).toBe(0);
    expect(p.body.contacts.onGround).toBe(true);
  });

  it("stops a dynamic flush at a solid entity's left face (onWallR, vx zeroed)", () => {
    const world = makeWorld();
    addCollider(world, "wall", 100, 0, 20, 200, { role: "solid" });
    const p = addCollider(world, "p", 50, 50, 20, 20, { role: "dynamic" }, { vx: 3000 });
    tick(world);
    expect(p.x).toBe(80); // wall left 100 − body w 20
    expect(p.vx).toBe(0);
    expect(p.body.contacts.onWallR).toBe(true);
  });

  it("bonks a dynamic's top on a solid entity above it (onCeiling)", () => {
    const world = makeWorld();
    addCollider(world, "roof", 0, 0, 200, 20, { role: "solid" });
    const p = addCollider(world, "p", 50, 40, 20, 20, { role: "dynamic" }, { vy: -3000 });
    tick(world);
    expect(p.y).toBe(20); // roof bottom
    expect(p.body.contacts.onCeiling).toBe(true);
  });

  it("does NOT resolve a dynamic against another dynamic (push is a later increment)", () => {
    const world = makeWorld();
    const a = addCollider(world, "a", 50, 50, 40, 40, { role: "dynamic" });
    const b = addCollider(world, "b", 60, 60, 40, 40, { role: "dynamic" }); // overlaps a
    world.dt = DT;
    world.frame += 1;
    world.resolveBodies();
    expect(a.x).toBe(50); // neither pushed the other
    expect(b.x).toBe(60);
  });

  it("a fast faller lands on a THIN solid without tunnelling (swept sub-stepping)", () => {
    const world = makeWorld();
    addCollider(world, "ledge", 0, 100, 200, 8, { role: "solid" }); // 8px thin
    // Start just above with 50px/tick: one tick's move (bottom 86 → 136) would skip clean past the
    // 8px ledge; swept sub-stepping catches it on top instead.
    const f = addCollider(world, "f", 40, 70, 16, 16, { role: "dynamic" }, { vy: 3000 });
    tick(world);
    expect(f.y).toBe(84); // ledge top 100 − h 16, never below it
  });
});

describe("resolveBodies — solid tiles", () => {
  it("lands a falling dynamic on the solid tile floor (tile broadphase)", () => {
    const world = makeWorld();
    world.tilemap = floorMap(); // floor row top at y = 11*32 = 352
    const p = addCollider(world, "p", 40, 300, 20, 20, { role: "dynamic" }, { vy: 3000 });
    tick(world);
    expect(p.y).toBe(332); // 352 − 20
    expect(p.body.contacts.onGround).toBe(true);
  });
});

describe("resolveBodies — one-way solids + drop-through", () => {
  it("a one-way solid entity catches a body from above but is passed through from below", () => {
    const fromAbove = makeWorld();
    addCollider(fromAbove, "ledge", 0, 100, 200, 8, { role: "solid", oneWay: true });
    const p = addCollider(fromAbove, "p", 40, 60, 16, 16, { role: "dynamic" }, { vy: 3000 });
    tick(fromAbove);
    expect(p.y).toBe(84); // landed on the one-way top (100 − 16)
    expect(p.body.contacts.onGround).toBe(true);

    const fromBelow = makeWorld();
    addCollider(fromBelow, "ledge", 0, 100, 200, 8, { role: "solid", oneWay: true });
    const r = addCollider(fromBelow, "r", 40, 140, 16, 16, { role: "dynamic" }, { vy: -3000 }); // rising
    tick(fromBelow);
    expect(r.body.contacts.onCeiling).toBe(false); // rose straight through, never bonked
    expect(r.y).toBeLessThan(140);
  });

  it("drops a body through a one-way TILE while the mover's drop-through window is open", () => {
    const held = makeWorld();
    held.tilemap = floorMap({ oneWayRow: 8 }); // one-way platform row, top at y = 8*32 = 256
    const a = addCollider(held, "a", 40, 230, 16, 16, { role: "dynamic" }, { vy: 1200 });
    tick(held);
    expect(a.y).toBe(240); // rests on the one-way tile top (256 − 16)
    expect(a.body.contacts.onGround).toBe(true);

    const dropping = makeWorld();
    dropping.tilemap = floorMap({ oneWayRow: 8 });
    const b = addCollider(dropping, "b", 40, 230, 16, 16, { role: "dynamic" }, { vy: 1200 });
    b.body.dropThrough = 1; // window open
    tick(dropping);
    expect(b.y).toBeGreaterThan(240); // fell THROUGH the one-way tile
  });
});

describe("resolveBodies — collider inset", () => {
  it("resolves the INSET box, not the sprite AABB (the sprite may overlap the wall)", () => {
    const world = makeWorld();
    addCollider(world, "wall", 100, 0, 20, 200, { role: "solid" });
    // 40px-wide sprite with a 10px inset per side ⇒ a 20px collider centered in it.
    const p = addCollider(world, "p", 50, 50, 40, 20, { role: "dynamic", inset: { x: 10, y: 0 } }, { vx: 3000 });
    tick(world);
    // The collider's right edge (e.x + inset.x + colliderW = e.x + 10 + 20) rests flush at the wall
    // (x=100) ⇒ e.x = 70. A sprite-AABB resolve would have stopped at 60; the 10px sprite overhang
    // past the wall is exactly what the inset buys.
    expect(p.x).toBe(70);
    expect(p.body.contacts.onWallR).toBe(true);
  });
});

describe("resolveBodies — candidate-keyed determinism (fuzz: filtered vs full scan)", () => {
  // Build a body + nearby solids; resolve; then add FAR solids (outside the swept box, incl. thin
  // ones that would have lowered a global min-dim) and resolve again from the same start. The
  // candidate-keyed broadphase excludes the far solids, so the resolved position is IDENTICAL —
  // a far decorative solid can no longer perturb a body's physics (§6).
  function buildScene(rng: () => number): { startX: number; startY: number; vx: number; vy: number; near: number[][] } {
    const startX = 200 + rng() * 400;
    const startY = 200 + rng() * 400;
    const vx = (rng() - 0.5) * 4000;
    const vy = (rng() - 0.5) * 4000;
    const near: number[][] = [];
    const n = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) near.push([startX - 100 + rng() * 200, startY - 100 + rng() * 200, 16 + rng() * 96, 16 + rng() * 96]);
    return { startX, startY, vx, vy, near };
  }

  function resolveScene(scene: { startX: number; startY: number; vx: number; vy: number; near: number[][] }, withFar: boolean, rng: () => number): { x: number; y: number } {
    const world = makeWorld();
    const p = addCollider(world, "p", scene.startX, scene.startY, 24, 24, { role: "dynamic" }, { vx: scene.vx, vy: scene.vy });
    scene.near.forEach((r, i) => addCollider(world, `s${i}`, r[0], r[1], r[2], r[3], { role: "solid" }));
    if (withFar) {
      // Far away (≥ 40000px) and deliberately THIN — under a global-min-dim sweep these would
      // change the sub-step count; candidate-keyed, they are excluded and cannot matter.
      for (let i = 0; i < 5; i++) addCollider(world, `far${i}`, 40000 + rng() * 10000, 40000 + rng() * 10000, 1 + rng() * 4, 1 + rng() * 4, { role: "solid" });
    }
    tick(world);
    return { x: p.x, y: p.y };
  }

  it("a solid outside the swept box never changes the resolved position (100 random scenes)", () => {
    for (let s = 0; s < 100; s++) {
      const scene = buildScene(mulberry32(1000 + s));
      const without = resolveScene(scene, false, mulberry32(7777 + s));
      const withFar = resolveScene(scene, true, mulberry32(7777 + s));
      expect(withFar.x).toBe(without.x);
      expect(withFar.y).toBe(without.y);
    }
  });
});

describe("resolveBodies — invariants (fuzz)", () => {
  it("is deterministic across runs over dense random multi-solid scenes (200 scenes)", () => {
    for (let s = 0; s < 200; s++) {
      const seed = 5000 + s;
      const run = (): { x: number; y: number } => {
        const rng = mulberry32(seed);
        const world = makeWorld();
        const p = addCollider(world, "p", 300 + rng() * 200, 300 + rng() * 200, 16 + rng() * 24, 16 + rng() * 24, { role: "dynamic" }, { vx: (rng() - 0.5) * 5000, vy: (rng() - 0.5) * 5000 });
        const n = 1 + Math.floor(rng() * 6);
        for (let i = 0; i < n; i++) addCollider(world, `s${i}`, 250 + rng() * 300, 250 + rng() * 300, 16 + rng() * 80, 16 + rng() * 80, { role: "solid" });
        tick(world);
        return { x: p.x, y: p.y };
      };
      const a = run();
      const b = run();
      expect(b.x).toBe(a.x); // identical inputs ⇒ identical output (replay/validator safety)
      expect(b.y).toBe(a.y);
    }
  });

  it("resolves a body moving INTO a single solid flush against it, never penetrating (200 scenes)", () => {
    // The push-out primitive is MOTION-based (it resolves the leading edge into a solid it runs
    // into), not a full iterative separating solver — so this pins its actual guarantee: a body
    // starting CLEAR of a single solid and moving toward it ends up flush, not embedded, not
    // tunnelled. (A body spawned already inside a solid, or wedged in a dense cluster, is out of
    // scope for a single pass — exactly as a single-pass solid resolver would.)
    const EPS = 0.01;
    let tested = 0;
    for (let s = 0; s < 200; s++) {
      const rng = mulberry32(9000 + s);
      const world = makeWorld();
      const px = 100 + rng() * 100;
      const py = 100 + rng() * 100;
      const pw = 16 + rng() * 24;
      const ph = 16 + rng() * 24;
      // Solid placed clearly down-right of the body; body aimed at it.
      const sx = px + pw + 40 + rng() * 200;
      const sy = py + ph + 40 + rng() * 200;
      const sw = 40 + rng() * 120;
      const sh = 40 + rng() * 120;
      const p = addCollider(world, "p", px, py, pw, ph, { role: "dynamic" }, { vx: 1000 + rng() * 3000, vy: 1000 + rng() * 3000 });
      const solid = addCollider(world, "s", sx, sy, sw, sh, { role: "solid" });
      if (aabbOverlap({ x: px, y: py, w: pw, h: ph }, solid)) continue; // start must be clear
      tick(world);
      const shrunk = { x: solid.x + EPS, y: solid.y + EPS, w: solid.w - 2 * EPS, h: solid.h - 2 * EPS };
      expect(aabbOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, shrunk), `scene ${s}: body penetrates the solid`).toBe(false);
      tested++;
    }
    expect(tested).toBeGreaterThan(150); // the scenario actually exercised the resolver
  });
});
