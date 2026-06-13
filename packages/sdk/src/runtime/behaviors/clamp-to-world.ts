import type { BehaviorFn } from "../types.js";
import { num, str } from "../params.js";

/**
 * Keeps an entity inside the world bounds on one or both axes, zeroing the
 * clamped velocity component so it doesn't stick to the wall. Used for paddles
 * and player characters.
 *
 * Params:
 *  - `axis`: `"x"` | `"y"` | `"both"` (default `"both"`)
 *  - `padding`: inset from each edge in px (structural literal allowed)
 */
export const clampToWorld: BehaviorFn = (entity, world, params) => {
  const axis = str(params, "axis", "both");
  const pad = num(params, "padding", 0);
  const W = world.bounds.width;
  const H = world.bounds.height;

  if (axis === "x" || axis === "both") {
    const min = pad;
    const max = W - entity.w - pad;
    if (entity.x < min) {
      entity.x = min;
      if (entity.vx < 0) entity.vx = 0;
    } else if (entity.x > max) {
      entity.x = max;
      if (entity.vx > 0) entity.vx = 0;
    }
  }
  if (axis === "y" || axis === "both") {
    const min = pad;
    const max = H - entity.h - pad;
    if (entity.y < min) {
      entity.y = min;
      if (entity.vy < 0) entity.vy = 0;
    } else if (entity.y > max) {
      entity.y = max;
      if (entity.vy > 0) entity.vy = 0;
    }
  }
};
