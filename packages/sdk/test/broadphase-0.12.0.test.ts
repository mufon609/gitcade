import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry, entitiesOverlap, type Sprite } from "../src/index.js";
import { aabbCollision } from "../src/runtime/systems/aabb-collision.js";

/**
 * 0.12.0 — the uniform-grid broadphase in `aabb-collision`. At scale it replaces the O(n·m)
 * nested loop, but must produce BYTE-IDENTICAL `entity.collisions` (contents AND order) so
 * determinism (replays/validator) is preserved. These tests pin that against an independent
 * naive computation at a pair size well above the grid threshold (256).
 */
const NONE: Sprite = { kind: "none" };

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
  return new World({ bounds: { width: 1200, height: 800 }, config: {}, registry: createDefaultRegistry() });
}

function add(world: World, id: string, x: number, y: number, w: number, h: number, tags: string[]): Entity {
  const e = new Entity({ id, x, y, w, h, layer: 0, sprite: NONE, tags });
  world.add(e);
  return e;
}

describe("aabb-collision — uniform-grid broadphase", () => {
  it("is byte-identical to the naive loop for a large DISJOINT-tag pair (a×b)", () => {
    const world = makeWorld();
    const rng = mulberry32(42);
    const N = 200; // 200×200 = 40000 ≫ threshold → grid path
    for (let i = 0; i < N; i++) add(world, `a${i}`, rng() * 1180, rng() * 780, 16 + rng() * 24, 16 + rng() * 24, ["a"]);
    for (let i = 0; i < N; i++) add(world, `b${i}`, rng() * 1180, rng() * 780, 16 + rng() * 24, 16 + rng() * 24, ["b"]);
    const as = world.query("a");
    const bs = world.query("b");
    expect(as.length * bs.length).toBeGreaterThan(256); // grid engaged

    // Independent naive reference — the EXACT order the nested loop yields (a→bs in bs-order; b→as in as-order).
    const expA = as.map((ea) => bs.filter((eb) => entitiesOverlap(ea, eb)).map((eb) => eb.id));
    const expB = bs.map((eb) => as.filter((ea) => entitiesOverlap(ea, eb)).map((ea) => ea.id));
    expect(expA.some((arr) => arr.length > 0)).toBe(true); // the scenario actually has overlaps

    aabbCollision(world, { pairs: [["a", "b"]] }, 1 / 60);
    as.forEach((ea, i) => expect(ea.collisions.map((e) => e.id)).toEqual(expA[i]));
    bs.forEach((eb, i) => expect(eb.collisions.map((e) => e.id)).toEqual(expB[i]));
  });

  it("is byte-identical for a large SELF-pair (same tag, ascending-index order)", () => {
    const world = makeWorld();
    const rng = mulberry32(7);
    const balls: Entity[] = [];
    for (let i = 0; i < 200; i++) balls.push(add(world, `x${i}`, rng() * 1180, rng() * 780, 16 + rng() * 16, 16 + rng() * 16, ["x"]));
    const expected = balls.map((e) => balls.filter((o) => o !== e && entitiesOverlap(e, o)).map((o) => o.id));
    expect(expected.some((arr) => arr.length > 0)).toBe(true);
    aabbCollision(world, { pairs: [["x", "x"]] }, 1 / 60);
    balls.forEach((e, i) => expect(e.collisions.map((c) => c.id)).toEqual(expected[i]));
  });

  it("takes the naive path unchanged below the threshold", () => {
    const world = makeWorld();
    const a1 = add(world, "a1", 0, 0, 20, 20, ["a"]);
    const a2 = add(world, "a2", 10, 10, 20, 20, ["a"]); // overlaps a1
    const a3 = add(world, "a3", 500, 500, 20, 20, ["a"]); // separate
    aabbCollision(world, { pairs: [["a", "a"]] }, 1 / 60);
    expect(a1.collisions.map((e) => e.id)).toEqual(["a2"]);
    expect(a2.collisions.map((e) => e.id)).toEqual(["a1"]);
    expect(a3.collisions).toEqual([]);
  });

  it("completes a 1000-collider self-pair without throwing (grid broadphase at scale)", () => {
    const world = makeWorld();
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) add(world, `p${i}`, rng() * 1180, rng() * 780, 12, 12, ["p"]);
    expect(() => aabbCollision(world, { pairs: [["p", "p"]] }, 1 / 60)).not.toThrow();
  });
});
