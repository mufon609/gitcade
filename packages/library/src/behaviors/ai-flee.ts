import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
import { toward, length, normalize, applyVelocity, lockAxis } from "../util.js";

/**
 * Flee from the nearest entity carrying `threatTag` — the mirror of `ai-chase`.
 * Only panics when the threat is within `panicDistance` (0 = always flee), so it
 * doubles as a skittish critter that bolts when approached. SETS velocity each
 * tick — order a `velocity` behavior AFTER it.
 *
 * Params:
 *  - `threatTag`: tag of the entity to flee from
 *  - `speed`: flee speed in px/sec (balance → `$cfg`)
 *  - `panicDistance`: only flee when the threat is within this distance (balance → `$cfg`; 0 = always)
 *  - `accel`: optional acceleration in px/sec² (balance → `$cfg`; 0 = snap)
 *  - `lockAxis`: `"x"` | `"y"` | `"none"` — constrain fleeing to one axis (default `"none"`)
 */
export const aiFlee: BehaviorFn = (entity, world, params, dt) => {
  const threatTag = str(params, "threatTag");
  const speed = num(params, "speed", 0);
  const panic = num(params, "panicDistance", 0);
  const accel = num(params, "accel", 0);
  const axis = lockAxis(params.lockAxis);

  const threat = world.nearest(entity, threatTag);
  if (!threat) {
    applyVelocity(entity, 0, 0, accel, dt);
    return;
  }

  const delta = toward(entity, threat);
  if (panic > 0 && length(delta) > panic) {
    applyVelocity(entity, 0, 0, accel, dt);
    return;
  }

  // Away from the threat.
  let dir = normalize({ x: -delta.x, y: -delta.y });
  if (axis === "x") dir = { x: -Math.sign(delta.x) || 0, y: 0 };
  else if (axis === "y") dir = { x: 0, y: -Math.sign(delta.y) || 0 };

  applyVelocity(entity, dir.x * speed, dir.y * speed, accel, dt);
};
