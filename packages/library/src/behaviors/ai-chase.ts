import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
import { toward, length, normalize, applyVelocity, lockAxis } from "../util.js";

/**
 * Pursue the nearest entity carrying `targetTag`, full 2D. Generalizes the SDK's
 * 1-axis `follow-entity-axis` primitive into omnidirectional pursuit with an
 * optional axis lock and optional acceleration. SETS velocity each tick — order a
 * `velocity` behavior AFTER this one so the chosen velocity is integrated.
 *
 * This is one of the four REUSE-PROOF parts: it powers the snake-tail threat,
 * tower-defense creeps advancing on the core, survival-arena mobs, and
 * space-invaders descent (via `lockAxis: "y"`). No genre needed a bespoke chaser.
 *
 * Params:
 *  - `targetTag`: tag of the entity to pursue (e.g. `"player"`, `"core"`)
 *  - `speed`: pursuit speed in px/sec (balance → `$cfg`)
 *  - `stopDistance`: center distance within which it holds still (balance → `$cfg`; default 0)
 *  - `accel`: optional approach acceleration in px/sec² (balance → `$cfg`; 0 = snap to speed)
 *  - `lockAxis`: `"x"` | `"y"` | `"none"` — constrain pursuit to one axis (default `"none"`)
 */
export const aiChase: BehaviorFn = (entity, world, params, dt) => {
  const targetTag = str(params, "targetTag");
  const speed = num(params, "speed", 0);
  const stopDistance = num(params, "stopDistance", 0);
  const accel = num(params, "accel", 0);
  const axis = lockAxis(params.lockAxis);

  const target = world.nearest(entity, targetTag);
  if (!target) {
    applyVelocity(entity, 0, 0, accel, dt);
    return;
  }

  const delta = toward(entity, target);
  if (length(delta) <= stopDistance) {
    applyVelocity(entity, 0, 0, accel, dt);
    return;
  }

  let dir = normalize(delta);
  if (axis === "x") dir = { x: Math.sign(delta.x), y: 0 };
  else if (axis === "y") dir = { x: 0, y: Math.sign(delta.y) };

  applyVelocity(entity, dir.x * speed, dir.y * speed, accel, dt);
};
