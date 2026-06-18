import type { BehaviorFn } from "@gitcade/sdk";
import { num, bool } from "@gitcade/sdk";

/**
 * `face-velocity` — the side-scroller FLIP convention (INDIE-ROADMAP Tier-1). Sets the
 * sign of `entity.scaleX` from the entity's horizontal velocity so a side-view sprite
 * faces the way it moves: moving right ⇒ `scaleX = +|scaleX|`, left ⇒ `-|scaleX|`. The
 * renderer already honors a negative `scaleX` as a horizontal flip around the entity
 * center (since 0.3.2), so this just wires that to motion — no rendering change.
 *
 * Distinct from `face-angle`, which ROTATES a top-down/projectile sprite to point along
 * its travel; this only mirrors a left/right sprite, leaving rotation untouched. It
 * preserves the scale MAGNITUDE (an entity authored at `scale: 2` stays 2× when flipped)
 * and HOLDS the current facing below `threshold` (a stopped sprite keeps facing the way
 * it last moved instead of snapping right). Visual only — collision/picking use the base
 * AABB. Order it AFTER the mover so it reads the committed `vx`.
 *
 * Params:
 *  - `threshold`: min `|vx|` (px/sec) to change facing (balance → `$cfg`; default 1)
 *  - `invert`: set true when the art faces LEFT by default, so "moving right" mirrors it
 *    (structural; default false = art faces right)
 */
export const faceVelocity: BehaviorFn = (entity, _world, params) => {
  const threshold = num(params, "threshold", 1);
  const invert = bool(params, "invert", false);
  const dir = entity.vx > threshold ? 1 : entity.vx < -threshold ? -1 : 0;
  if (dir === 0) return; // (near-)stationary → hold the current facing
  const faceRight = invert ? dir < 0 : dir > 0;
  const mag = Math.abs(entity.scaleX) || 1; // preserve authored scale; never zero out
  entity.scaleX = faceRight ? mag : -mag;
};
