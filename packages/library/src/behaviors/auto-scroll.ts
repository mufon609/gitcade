import type { BehaviorFn } from "@gitcade/sdk";
import { num, bool } from "@gitcade/sdk";

/**
 * Move the entity at a constant velocity every tick, optionally wrapping it back
 * to the opposite edge when it leaves the world. Two roles: drive a scrolling
 * world/parallax tile (`wrap: true` for a seamless loop), or carry an
 * auto-advancing player/obstacle in a one-button scroller (`wrap: false`). Unlike
 * the SDK `velocity` primitive (which seeds once and can then be deflected), this
 * FORCES the velocity each tick so nothing knocks the scroll off course. Order a
 * `velocity` behavior AFTER it to integrate.
 *
 * Params:
 *  - `vx`/`vy`: constant scroll velocity in px/sec (balance → `$cfg`)
 *  - `wrap`: re-enter from the opposite edge on exit (default false)
 */
export const autoScroll: BehaviorFn = (entity, world, params) => {
  const vx = num(params, "vx", 0);
  const vy = num(params, "vy", 0);
  entity.vx = vx;
  entity.vy = vy;

  if (!bool(params, "wrap", false)) return;

  const W = world.bounds.width;
  const H = world.bounds.height;
  if (entity.x > W) entity.x = -entity.w;
  else if (entity.x + entity.w < 0) entity.x = W;
  if (entity.y > H) entity.y = -entity.h;
  else if (entity.y + entity.h < 0) entity.y = H;
};
