import type { BehaviorFn } from "../types.js";
import { num, strArray } from "../params.js";

/**
 * Reflects velocity when the entity reaches selected world edges, repositioning
 * it just inside the bound. Used for the ball bouncing off the top/bottom walls.
 * Put this BEFORE the `velocity` behavior in the entity's array.
 *
 * Params:
 *  - `edges`: any of `"top"`, `"bottom"`, `"left"`, `"right"`
 *  - `restitution`: bounce energy multiplier (balance → `$cfg`; default 1)
 */
export const bounceWorldEdges: BehaviorFn = (entity, world, params) => {
  const edges = strArray(params, "edges");
  const r = num(params, "restitution", 1);
  const W = world.bounds.width;
  const H = world.bounds.height;
  let bounced = false;

  if (edges.includes("top") && entity.y < 0) {
    entity.y = 0;
    entity.vy = Math.abs(entity.vy) * r;
    bounced = true;
  }
  if (edges.includes("bottom") && entity.y + entity.h > H) {
    entity.y = H - entity.h;
    entity.vy = -Math.abs(entity.vy) * r;
    bounced = true;
  }
  if (edges.includes("left") && entity.x < 0) {
    entity.x = 0;
    entity.vx = Math.abs(entity.vx) * r;
    bounced = true;
  }
  if (edges.includes("right") && entity.x + entity.w > W) {
    entity.x = W - entity.w;
    entity.vx = -Math.abs(entity.vx) * r;
    bounced = true;
  }

  if (bounced) world.audio.play("bounce");
};
