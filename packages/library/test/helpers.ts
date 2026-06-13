import { World, Entity, createDefaultRegistry, type Config } from "@gitcade/sdk";
import { registerLibrary } from "../src/registry.js";
import type { Sprite } from "@gitcade/sdk";

/** Deterministic seedable RNG (mulberry32) so wander/spread tests are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A world wired with the SDK built-ins + the full library, ready for unit tests. */
export function makeWorld(opts: { bounds?: { width: number; height: number }; config?: Config; seed?: number } = {}): World {
  const registry = createDefaultRegistry();
  registerLibrary(registry);
  return new World({
    bounds: opts.bounds ?? { width: 800, height: 600 },
    config: opts.config ?? {},
    registry,
    rng: mulberry32(opts.seed ?? 1),
  });
}

const NONE: Sprite = { kind: "none" };

/** Build + add a bare entity to the world. Behaviors are attached by the test as needed. */
export function makeEntity(
  world: World,
  init: { id: string; x?: number; y?: number; w?: number; h?: number; tags?: string[]; state?: Record<string, unknown>; sprite?: Sprite },
): Entity {
  const e = new Entity({
    id: init.id,
    x: init.x ?? 0,
    y: init.y ?? 0,
    w: init.w ?? 16,
    h: init.h ?? 16,
    layer: 0,
    sprite: init.sprite ?? NONE,
    tags: init.tags ?? [],
    state: init.state ?? {},
  });
  world.add(e);
  return e;
}

/** Manually mark `b` as colliding with `a` this tick (as the aabb-collision system would). */
export function collide(a: Entity, b: Entity): void {
  if (!a.collisions.includes(b)) a.collisions.push(b);
  if (!b.collisions.includes(a)) b.collisions.push(a);
}
