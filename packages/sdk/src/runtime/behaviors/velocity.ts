import type { BehaviorFn } from "../types.js";

/**
 * transform + velocity primitive. Seeds the entity's velocity from `vx`/`vy`
 * params on the first tick, then integrates `position += velocity * dt` each
 * tick. Put this AFTER velocity-changing behaviors (reflect/bounce/input) in an
 * entity's `behaviors` array so reflections apply before integration.
 *
 * Params: `vx`, `vy` — initial velocity in px/sec (balance → `$cfg`).
 */
export const velocity: BehaviorFn = (entity, _world, params, dt) => {
  if (!entity.state.__velInit) {
    if (typeof params.vx === "number") entity.vx = params.vx;
    if (typeof params.vy === "number") entity.vy = params.vy;
    entity.state.__velInit = true;
  }
  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;
};
