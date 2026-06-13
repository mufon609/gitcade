import type { BehaviorFn } from "../types.js";
import { num, str } from "../params.js";

/**
 * Reflects this entity's velocity on collision with entities carrying `tag`,
 * pushing it clear of the obstacle to prevent re-hits, and optionally speeding
 * it up (capped). Optional `english` adds spin based on where it struck the
 * obstacle (classic Pong paddle feel). Requires the `aabb-collision` system to
 * have populated `entity.collisions` for the relevant tag pair this tick.
 *
 * Params:
 *  - `tag`: obstacle tag to react to (e.g. `"paddle"`)
 *  - `axis`: `"x"` | `"y"` — which velocity component to flip
 *  - `speedScale`: per-hit speed multiplier (balance → `$cfg`; default 1)
 *  - `maxSpeed`: cap on that axis (balance → `$cfg`; optional)
 *  - `english`: spin imparted on the other axis (balance → `$cfg`; optional)
 */
export const reflectOnHit: BehaviorFn = (entity, world, params) => {
  const tag = str(params, "tag");
  const axis = str(params, "axis", "x") === "y" ? "y" : "x";
  const scale = num(params, "speedScale", 1);
  const maxSpeed = typeof params.maxSpeed === "number" ? params.maxSpeed : Infinity;
  const english = num(params, "english", 0);

  const other = entity.collisions.find((e) => e.hasTag(tag));
  if (!other) return;

  if (axis === "x") {
    const dir = Math.sign(entity.cx - other.cx) || 1;
    const v = Math.min(Math.abs(entity.vx) * scale, maxSpeed);
    entity.vx = dir * v;
    entity.x = dir > 0 ? other.x + other.w : other.x - entity.w;
    if (english) {
      const offset = (entity.cy - other.cy) / (other.h / 2 || 1);
      entity.vy += offset * english;
    }
  } else {
    const dir = Math.sign(entity.cy - other.cy) || 1;
    const v = Math.min(Math.abs(entity.vy) * scale, maxSpeed);
    entity.vy = dir * v;
    entity.y = dir > 0 ? other.y + other.h : other.y - entity.h;
    if (english) {
      const offset = (entity.cx - other.cx) / (other.w / 2 || 1);
      entity.vx += offset * english;
    }
  }

  world.audio.play("hit");
};
