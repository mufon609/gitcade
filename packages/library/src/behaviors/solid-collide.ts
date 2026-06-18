import type { BehaviorFn, SolidRect } from "@gitcade/sdk";
import { str, resolveSolids, applyContacts } from "@gitcade/sdk";

/**
 * Resolve an entity's AABB against OTHER entities tagged solid — the entity-vs-entity
 * half of platformer collision (INDIE-ROADMAP Tier-0 item 0.3), so a crate, a ledge, or
 * a moving lift is exactly as solid as a tile. The carrying entity is pushed out of any
 * `solidTag` body it ran into, the contacted velocity component is zeroed, and it writes
 * the SAME typed contact flags as `tilemap-collide` (`entity.contacts.onGround`/`onCeiling`/
 * `onWallL`/`onWallR`) — so `move-platformer` can jump off a crate top, and a lift the
 * entity rests on raises it each tick (the resolver re-grounds it against the lift's new
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
 * ONE-WAY (pass-through) LEDGES (0.7.0): entities tagged `oneWayTag` (default off) are
 * solid only on their TOP face — a body lands on the ledge from above but jumps up
 * THROUGH it and passes it sideways, and the mover's drop-through (`entity.dropThrough`)
 * suppresses it so a standing body can fall through. The entity-side mirror of a one-way
 * tile; leave `oneWayTag` empty to skip the extra query entirely.
 *
 * Params:
 *  - `solidTag`: tag marking fully-solid entities to resolve against (default `"solid"`);
 *    the entity carrying this behavior is skipped, so it may itself carry the tag.
 *  - `oneWayTag`: tag marking one-way (top-only) ledge entities (default `""` = off)
 */
export const solidCollide: BehaviorFn = (entity, world, params, dt) => {
  const solidTag = str(params, "solidTag", "solid");
  const oneWayTag = str(params, "oneWayTag", "");
  const dropping = entity.dropThrough > 0;
  const rects: SolidRect[] = [];
  for (const s of world.query(solidTag)) {
    if (s === entity) continue;
    rects.push({ x: s.x, y: s.y, w: s.w, h: s.h });
  }
  if (oneWayTag && !dropping) {
    for (const s of world.query(oneWayTag)) {
      if (s === entity) continue;
      rects.push({ x: s.x, y: s.y, w: s.w, h: s.h, oneWay: true });
    }
  }
  const contacts = resolveSolids(entity, rects, dt);
  applyContacts(entity, world.frame, contacts);
};
