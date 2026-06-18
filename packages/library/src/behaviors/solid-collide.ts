import type { BehaviorFn, AABB } from "@gitcade/sdk";
import { str, resolveSolids, applyContacts } from "@gitcade/sdk";

/**
 * Resolve an entity's AABB against OTHER entities tagged solid — the entity-vs-entity
 * half of platformer collision (INDIE-ROADMAP Tier-0 item 0.3), so a crate, a ledge, or
 * a moving lift is exactly as solid as a tile. The carrying entity is pushed out of any
 * `solidTag` body it ran into, the contacted velocity component is zeroed, and it writes
 * the SAME contact flags as `tilemap-collide` (`__onGround`/`__onCeiling`/`__onWallL`/
 * `__onWallR`) — so `move-platformer` can jump off a crate top, and a lift the entity
 * rests on raises it each tick (the resolver re-grounds it against the lift's new
 * position).
 *
 * Pairs with `tilemap-collide`: run BOTH on a player and the flags MERGE per tick (the
 * SDK's `applyContacts` stamps the frame), so "grounded on a tile OR a solid body" is
 * read correctly in any order. ORDER IT AFTER the velocity integrator, like
 * `tilemap-collide`. Resolution is the shared SDK `resolveSolids` primitive, so a fast
 * body sub-steps and can't tunnel a thin solid (0.4).
 *
 * This is a ONE-WAY push-out: the carrying entity is moved, the solids are not (they are
 * "as solid as a tile" — immovable). Movable crates / a lift that carries you sideways
 * are two-body dynamics for a later tier; standing/landing/blocking/riding-a-vertical-
 * lift all work from push-out alone.
 *
 * Params:
 *  - `solidTag`: tag marking solid entities to resolve against (default `"solid"`); the
 *    entity carrying this behavior is skipped, so it may itself carry the tag.
 */
export const solidCollide: BehaviorFn = (entity, world, params, dt) => {
  const solidTag = str(params, "solidTag", "solid");
  const rects: AABB[] = [];
  for (const s of world.query(solidTag)) {
    if (s === entity) continue;
    rects.push({ x: s.x, y: s.y, w: s.w, h: s.h });
  }
  const contacts = resolveSolids(entity, rects, dt);
  applyContacts(entity.state, world.frame, contacts);
};
