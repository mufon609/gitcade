import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `face-angle` — orient an entity by writing `entity.rotation` (radians, clockwise)
 * each tick. Pairs with the 0.3.2 renderer, which rotates a sprite around its center
 * by `entity.rotation` (a slot that was in the frozen entity schema but ignored by
 * the renderer until 0.3.2). This is the DATA path to a directional sprite: before
 * it, a flyer couldn't bank, a turret couldn't track, a bullet couldn't point along
 * its travel — every sprite was fixed-orientation. Visual only — collision/picking
 * stay axis-aligned (the renderer applies the transform purely for drawing).
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
    entity.rotation = Math.atan2(t.cy - entity.cy, t.cx - entity.cx) + offset;
    return;
  }

  if (mode === "pointer") {
    const p = world.input.activePointers()[0];
    if (!p) return; // no active pointer → keep current facing
    entity.rotation = Math.atan2(p.y - entity.cy, p.x - entity.cx) + offset;
    return;
  }

  // mode === "velocity" (default)
  const minSpeed = num(params, "minSpeed", 0);
  const speed = Math.hypot(entity.vx, entity.vy);
  if (speed <= minSpeed) return; // (near-)stationary → hold previous rotation
  entity.rotation = Math.atan2(entity.vy, entity.vx) + offset;
};
