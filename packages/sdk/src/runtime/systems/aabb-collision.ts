import type { SystemFn } from "../types.js";
import type { Entity } from "../entity.js";
import { entitiesOverlap } from "../collision.js";

/**
 * Pair size (`|tagA| * |tagB|`) above which the uniform-grid broadphase replaces the naive
 * O(n·m) nested loop. Below it, the naive path runs verbatim — so small scenes (every shipped
 * game) take the exact pre-broadphase code path and are byte-identical; the grid only engages
 * once a pair is large enough for its O(n+m) build to pay off.
 */
const BROADPHASE_THRESHOLD = 256;

/**
 * AABB collision detection + events primitive. For each configured tag pair, finds overlapping
 * entities and records each in the other's `entity.collisions` list for behaviors (e.g.
 * `reflect-on-hit`, `contact-damage`) to react to this tick. Run this BEFORE entity behaviors
 * (it is registered/ordered first) so collision data is fresh when behaviors read it.
 *
 * Scales via a uniform-grid broadphase (0.12.0): for a large tag pair, the `b` entities are
 * bucketed into a spatial hash by cell (≈ the largest collider dimension), and each `a` tests
 * only the candidates in the cells its AABB overlaps — O(n+m) typical instead of O(n·m). The
 * result is BYTE-IDENTICAL to the naive nested loop: candidates are tested in ascending `b`-index
 * order (the same order `world.query(b)` yields), so each entity's `collisions` array — contents
 * AND order — is exactly what the naive loop produced. Determinism (replays/validator) is
 * preserved. Below {@link BROADPHASE_THRESHOLD} the naive loop runs unchanged.
 *
 * Params:
 *  - `pairs`: array of `[tagA, tagB]` tuples to test (e.g. `[["ball","paddle"]]`)
 */
export const aabbCollision: SystemFn = (world, params) => {
  const pairs = (Array.isArray(params.pairs) ? params.pairs : []) as Array<[string, string]>;
  for (const pair of pairs) {
    const [a, b] = pair;
    if (!a || !b) continue;
    const as = world.query(a);
    const bs = world.query(b);

    if (as.length * bs.length <= BROADPHASE_THRESHOLD) {
      // Naive O(n·m) — the exact pre-broadphase path, byte-identical for small pairs.
      for (const ea of as) {
        for (const eb of bs) {
          if (ea === eb) continue;
          if (entitiesOverlap(ea, eb)) record(ea, eb);
        }
      }
      continue;
    }

    // Uniform-grid broadphase. Cell ≈ the largest `b` collider so an entity spans only a few
    // cells. Bucket each `b`'s INDEX into every cell its AABB touches; then for each `a`, gather
    // the candidate `b`-indices from the cells its AABB touches, sort ascending (= `bs` order),
    // and test only those. Two overlapping AABBs always share a cell, so no overlap is missed.
    let cell = 1;
    for (const eb of bs) cell = Math.max(cell, eb.w, eb.h);
    const grid = new Map<string, number[]>();
    for (let j = 0; j < bs.length; j++) {
      forEachCell(bs[j], cell, (key) => {
        const bucket = grid.get(key);
        if (bucket) bucket.push(j);
        else grid.set(key, [j]);
      });
    }
    for (const ea of as) {
      const seen = new Set<number>();
      forEachCell(ea, cell, (key) => {
        const bucket = grid.get(key);
        if (bucket) for (const j of bucket) seen.add(j);
      });
      const candidates = [...seen].sort((x, y) => x - y); // ascending bs-index = naive iteration order
      for (const j of candidates) {
        const eb = bs[j];
        if (ea === eb) continue;
        if (entitiesOverlap(ea, eb)) record(ea, eb);
      }
    }
  }
};

/** Record a mutual collision (deduped), exactly as the naive loop does. */
function record(ea: Entity, eb: Entity): void {
  if (!ea.collisions.includes(eb)) ea.collisions.push(eb);
  if (!eb.collisions.includes(ea)) eb.collisions.push(ea);
}

/** Invoke `fn` once per grid cell key `"cx,cy"` that `e`'s AABB touches (negatives are fine). */
function forEachCell(e: Entity, cell: number, fn: (key: string) => void): void {
  const x0 = Math.floor(e.x / cell);
  const x1 = Math.floor((e.x + e.w) / cell);
  const y0 = Math.floor(e.y / cell);
  const y1 = Math.floor((e.y + e.h) / cell);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) fn(`${cx},${cy}`);
}
