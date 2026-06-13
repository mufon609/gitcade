import type { SystemFn } from "../types.js";
import { entitiesOverlap } from "../collision.js";

/**
 * AABB collision detection + events primitive. For each configured tag pair, finds
 * overlapping entities and records each in the other's `entity.collisions` list
 * for behaviors (e.g. `reflect-on-hit`, `contact-damage`) to react to this tick.
 * Run this BEFORE entity behaviors (it is registered/ordered first) so collision
 * data is fresh when behaviors read it.
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
    for (const ea of as) {
      for (const eb of bs) {
        if (ea === eb) continue;
        if (entitiesOverlap(ea, eb)) {
          if (!ea.collisions.includes(eb)) ea.collisions.push(eb);
          if (!eb.collisions.includes(ea)) eb.collisions.push(ea);
        }
      }
    }
  }
};
