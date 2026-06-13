import type { BehaviorFn } from "../types.js";
import { num, str } from "../params.js";

/**
 * Simple AI: move toward the nearest entity tagged `targetTag` along one axis at
 * a fixed speed, holding still within a deadzone. Powers the computer paddle in
 * single-player Pong; generalizes to any "track the player/ball" pursuit.
 *
 * Params:
 *  - `targetTag`: tag of the entity to track (e.g. `"ball"`)
 *  - `axis`: `"x"` | `"y"` (default `"y"`)
 *  - `speed`: tracking speed in px/sec (balance → `$cfg`)
 *  - `deadzone`: distance within which it stops (balance → `$cfg`; default 0)
 */
export const followEntityAxis: BehaviorFn = (entity, world, params) => {
  const targetTag = str(params, "targetTag");
  const axis = str(params, "axis", "y") === "x" ? "x" : "y";
  const speed = num(params, "speed", 0);
  const deadzone = num(params, "deadzone", 0);

  const target = world.nearest(entity, targetTag);
  if (!target) {
    if (axis === "y") entity.vy = 0;
    else entity.vx = 0;
    return;
  }

  const tc = axis === "y" ? target.cy : target.cx;
  const ec = axis === "y" ? entity.cy : entity.cx;
  const diff = tc - ec;
  const v = Math.abs(diff) <= deadzone ? 0 : Math.sign(diff) * speed;

  if (axis === "y") entity.vy = v;
  else entity.vx = v;
};
