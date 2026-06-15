import type { BehaviorFn } from "../types.js";
import { num, str } from "../params.js";
import { overlapAxis } from "../collision.js";

/**
 * Reflects this entity's velocity on collision with entities carrying `tag`,
 * pushing it clear of the obstacle to prevent re-hits, and optionally speeding
 * it up (capped). Optional `english` adds spin based on where it struck the
 * obstacle (classic Pong paddle feel). Requires the `aabb-collision` system to
 * have populated `entity.collisions` for the relevant tag pair this tick.
 *
 * Params:
 *  - `tag`: obstacle tag to react to (e.g. `"paddle"`)
 *  - `axis`: `"x"` | `"y"` — which velocity component to flip (a FIXED axis), or
 *    `"auto"` to pick the flip axis per-hit from the minimum-translation overlap
 *    (reflect off whichever face was actually struck — bricks, walls, pinball)
 *  - `speedScale`: per-hit speed multiplier (balance → `$cfg`; default 1)
 *  - `maxSpeed`: cap on the resulting speed of each affected axis (balance →
 *    `$cfg`; optional) — bounds both the reflected axis AND the `english`-modified
 *    axis, so spin can never push a component past the cap
 *  - `english`: spin imparted on the other axis (balance → `$cfg`; optional)
 */
export const reflectOnHit: BehaviorFn = (entity, world, params) => {
  const tag = str(params, "tag");
  const axisParam = str(params, "axis", "x");
  const scale = num(params, "speedScale", 1);
  const maxSpeed = typeof params.maxSpeed === "number" ? params.maxSpeed : Infinity;
  const english = num(params, "english", 0);

  const other = entity.collisions.find((e) => e.hasTag(tag));
  if (!other) return;

  // "auto" (B-3): pick the flip axis from the actual overlap so a side hit
  // reflects on x and a top/bottom hit on y (no tunneling). "x"/"y" stay a fixed
  // axis — byte-identical to the original (Pong relies on axis:"x").
  const axis = axisParam === "auto" ? overlapAxis(entity, other) : axisParam === "y" ? "y" : "x";

  if (axis === "x") {
    const dir = Math.sign(entity.cx - other.cx) || 1;
    const v = Math.min(Math.abs(entity.vx) * scale, maxSpeed);
    entity.vx = dir * v;
    entity.x = dir > 0 ? other.x + other.w : other.x - entity.w;
    if (english) {
      const offset = (entity.cy - other.cy) / (other.h / 2 || 1);
      entity.vy = clamp(entity.vy + offset * english, maxSpeed); // english axis capped too (B-4)
    }
  } else {
    const dir = Math.sign(entity.cy - other.cy) || 1;
    const v = Math.min(Math.abs(entity.vy) * scale, maxSpeed);
    entity.vy = dir * v;
    entity.y = dir > 0 ? other.y + other.h : other.y - entity.h;
    if (english) {
      const offset = (entity.cx - other.cx) / (other.w / 2 || 1);
      entity.vx = clamp(entity.vx + offset * english, maxSpeed); // english axis capped too (B-4)
    }
  }

  world.audio.play("hit");
};

/** Clamp a velocity component to ±limit (no-op when limit is Infinity). */
function clamp(v: number, limit: number): number {
  if (v > limit) return limit;
  if (v < -limit) return -limit;
  return v;
}
