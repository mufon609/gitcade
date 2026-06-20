import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `face-angle` — orient an entity by writing `entity.rotation` (radians, clockwise)
 * each tick. The renderer rotates a sprite around its center by `entity.rotation`, so
 * this is the DATA path to a directional sprite: a flyer banking, a turret tracking, a
 * bullet pointing along its travel. Visual only — collision/picking stay axis-aligned
 * (the renderer applies the transform purely for drawing).
 *
 * Modes (`mode`, default `"velocity"`):
 *  - `"velocity"`: `rotation = atan2(vy, vx) + offset`, for a sprite whose forward
 *    points +x (right). Holds the previous rotation below `minSpeed` so a stopped
 *    entity doesn't snap back to 0. Order this AFTER the mover + `velocity`
 *    integrator so it reads the committed velocity. (projectiles, top-down movers)
 *  - `"target"`: face the NEAREST live entity tagged `targetTag`. Keeps the current
 *    facing when no target is in the world. (turrets, sentries)
 *  - `"pointer"`: face the first active pointer in world space — twin-stick aim
 *    (move with the keys, point at the cursor/touch).
 *  - `"tilt"`: map a single velocity axis to a CLAMPED bank angle,
 *    `rotation = clamp(v[axis] * tiltPerVel, -maxTilt, maxTilt) + offset`. For a
 *    side-scroller flyer that pitches nose-up while rising and nose-down while
 *    falling (helicopter). `axis` = `"vy"` (default) | `"vx"`.
 *
 * Params (numeric values are balance → `$cfg`; strings are structural):
 *  - `mode`: `"velocity" | "target" | "pointer" | "tilt"` (default `"velocity"`)
 *  - `offset`: radians added to the computed angle, to correct a sprite whose art
 *    doesn't point +x (e.g. a sprite drawn pointing up uses `offset = π/2`); default 0
 *  - `targetTag`: tag to face in `"target"` mode
 *  - `minSpeed`: in `"velocity"` mode, hold facing below this speed in px/s (default 0)
 *  - `axis`: in `"tilt"` mode, `"vy"` | `"vx"` (default `"vy"`)
 *  - `tiltPerVel`: in `"tilt"` mode, radians of bank per px/s of the chosen axis
 *  - `maxTilt`: in `"tilt"` mode, clamp magnitude in radians (0 = unclamped)
 *
 * Determinism + frozen tick order preserved: a pure per-tick read + a single
 * `entity.rotation` write, run in normal behavior order; no RNG, events, or I/O.
 */
export const faceAngle: BehaviorFn = (entity, world, params) => {
  const mode = str(params, "mode", "velocity");
  const offset = num(params, "offset", 0);

  if (mode === "tilt") {
    const axis = str(params, "axis", "vy");
    const v = axis === "vx" ? entity.vx : entity.vy;
    const tiltPerVel = num(params, "tiltPerVel", 0);
    const maxTilt = num(params, "maxTilt", 0);
    let a = v * tiltPerVel;
    if (maxTilt > 0) a = Math.max(-maxTilt, Math.min(maxTilt, a));
    entity.rotation = a + offset;
    return;
  }

  if (mode === "target") {
    const targetTag = str(params, "targetTag", "");
    const t = targetTag ? world.nearest(entity, targetTag) : undefined;
    if (!t) return; // no target → keep current facing
    entity.rotation = world.math.atan2(t.cy - entity.cy, t.cx - entity.cx) + offset;
    return;
  }

  if (mode === "pointer") {
    const p = world.input.activePointers()[0];
    if (!p) return; // no active pointer → keep current facing
    entity.rotation = world.math.atan2(p.y - entity.cy, p.x - entity.cx) + offset;
    return;
  }

  // mode === "velocity" (default). `entity.rotation` feeds `snapshotWorld`, so the angle MUST be
  // cross-engine-deterministic — route atan2 through `world.math` (see fdmath). The min-speed gate
  // compares SQUARED speed (sqrt-free + deterministic); the magnitude itself isn't needed.
  const minSpeed = num(params, "minSpeed", 0);
  if (entity.vx * entity.vx + entity.vy * entity.vy <= minSpeed * minSpeed) return;
  entity.rotation = world.math.atan2(entity.vy, entity.vx) + offset;
};
