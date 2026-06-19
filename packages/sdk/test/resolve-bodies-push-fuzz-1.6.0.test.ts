import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, type Sprite } from "../src/index.js";
import type { ColliderComponent } from "../src/runtime/entity.js";
import type { Tilemap } from "../src/schema/scene.js";

/**
 * 1.6.0 — the push relaxation's DETERMINISM + NO-PENETRATION fuzz harness (the audit's "missing
 * harness" for `World.resolvePush`). The solid push-out got a candidate-keyed fuzz harness at 1.1.0;
 * push (the 3-phase positional relaxation with blocked-propagation + a fixed `PUSH_ITERATIONS` cap)
 * shipped at 1.4.0 with NONE. This pins push's two load-bearing invariants over random scenes:
 *
 *  1. **Replay-determinism** — identical inputs ⇒ byte-identical output (the relaxation is a pure
 *     function of world state; required for replays + the validator). The fixed iteration count and
 *     entity-array-order pair scan make this hold; the fuzz proves it across shapes/masses/counts.
 *  2. **No deep penetration** — after settling, a crate never deeply penetrates a solid (tile or
 *     entity) nor another crate. The bounded relaxation leaves at most sub-pixel residue on a dense
 *     chain (the documented crate↔crate flushness residue), never a deep overlap or a tunnel.
 *
 * Tolerances reflect the MEASURED residue (worst crate↔solid ≈ 0px, worst crate↔crate ≈ 1px over
 * 100 dense scenes) with headroom — a regression that let a crate sink into terrain or a neighbor
 * would blow past them.
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
): Entity {
  const e = new Entity({ id, x, y, w, h, layer: 0, sprite: NONE });
  e.body.collider = { role: collider.role, oneWay: collider.oneWay ?? false, carriable: collider.carriable ?? false, pushable: collider.pushable ?? false, mass: collider.mass ?? 1, inset: collider.inset ?? { x: 0, y: 0 } };
  world.add(e);
  return e;
}

/** One tick: integrate every body's velocity, then run the phase (the host loop's job, condensed). */
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

const penX = (a: Entity, b: Entity): number => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
const penY = (a: Entity, b: Entity): number => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

/**
 * Build a random "pusher drives N crates along a floor toward a right wall" scene and run it for
 * `frames` ticks. Returns a position snapshot (for the determinism check) plus the worst crate↔solid
 * and crate↔crate penetration after settling (for the no-penetration check).
 */
function runPushScene(seed: number, frames = 80): { snapshot: string; worstSolidPen: number; worstCratePen: number } {
  const rng = mulberry32(seed);
  const world = makeWorld();
  const cols = 60, rows = 30, ts = 32;
  const tiles = new Array<number>(cols * rows).fill(-1);
  for (let c = 0; c < cols; c++) tiles[(rows - 1) * cols + c] = 1; // floor (bottom row)
  for (let r = 0; r < rows; r++) tiles[r * cols + (cols - 1)] = 1; // right wall (last column)
  world.tilemap = { tileSize: ts, cols, rows, tiles, properties: { "1": { solid: true } } } as Tilemap;
  const floorTop = (rows - 1) * ts;
  const wallLeft = (cols - 1) * ts;

  const crates: Entity[] = [];
  const nCrates = 2 + Math.floor(rng() * 4);
  let cx = 200;
  for (let i = 0; i < nCrates; i++) {
    const w = 24 + Math.floor(rng() * 24);
    crates.push(addCollider(world, `c${i}`, cx, floorTop - 32, w, 32, { role: "dynamic", pushable: true, mass: 1 + Math.floor(rng() * 3) }));
    cx += w + rng() * 20;
  }
  const pusher = addCollider(world, "p", 150, floorTop - 24, 24, 24, { role: "dynamic" });
  const pushVx = 200 + rng() * 1000;

  for (let f = 0; f < frames; f++) {
    pusher.vx = pushVx;
    pusher.vy += 1200 * DT; // gravity
    for (const c of crates) c.vy += 1200 * DT;
    tick(world);
  }

  let worstSolidPen = 0;
  for (const c of crates) {
    if (c.x + c.w > wallLeft) worstSolidPen = Math.max(worstSolidPen, c.x + c.w - wallLeft);
    if (c.y + c.h > floorTop) worstSolidPen = Math.max(worstSolidPen, c.y + c.h - floorTop);
  }
  let worstCratePen = 0;
  for (let i = 0; i < crates.length; i++)
    for (let j = i + 1; j < crates.length; j++) {
      const px = penX(crates[i], crates[j]);
      const py = penY(crates[i], crates[j]);
      if (px > 0 && py > 0) worstCratePen = Math.max(worstCratePen, Math.min(px, py));
    }
  const snapshot = crates.map((c) => `${c.x.toFixed(6)},${c.y.toFixed(6)}`).join("|") + `#${pusher.x.toFixed(6)},${pusher.y.toFixed(6)}`;
  return { snapshot, worstSolidPen, worstCratePen };
}

describe("resolvePush — determinism fuzz", () => {
  it("is replay-deterministic: identical inputs ⇒ byte-identical output (100 random push scenes)", () => {
    for (let s = 0; s < 100; s++) {
      const a = runPushScene(3000 + s);
      const b = runPushScene(3000 + s);
      expect(b.snapshot, `scene ${s} diverged on replay`).toBe(a.snapshot);
    }
  });
});

describe("resolvePush — no-penetration fuzz", () => {
  it("never leaves a crate deeply penetrating a solid (tile/wall) — 100 random scenes", () => {
    let worst = 0;
    for (let s = 0; s < 100; s++) worst = Math.max(worst, runPushScene(3000 + s).worstSolidPen);
    expect(worst, `worst crate↔solid penetration ${worst.toFixed(3)}px`).toBeLessThan(1);
  });

  it("never leaves a crate deeply penetrating another crate — 100 random scenes", () => {
    let worst = 0;
    for (let s = 0; s < 100; s++) worst = Math.max(worst, runPushScene(3000 + s).worstCratePen);
    // Bounded relaxation residue is sub-pixel; a regression (under-iteration, broken mass-split)
    // would let crates sink deep into each other and blow well past this.
    expect(worst, `worst crate↔crate penetration ${worst.toFixed(3)}px`).toBeLessThan(2);
  });
});
