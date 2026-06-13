import type { BehaviorFn } from "@gitcade/sdk";
import { num, bool } from "@gitcade/sdk";
import { points, normalize, applyVelocity } from "../util.js";

/**
 * Move along an ordered list of waypoints. Heads toward the current waypoint at
 * `speed`; once within `arriveRadius` it advances to the next. At the end it
 * either loops back to the first point or stops and emits `"path-complete"`.
 * SETS velocity — order a `velocity` behavior AFTER it. The waypoint coordinates
 * are structural geometry (`x`/`y`, whitelisted); only `speed` is balance.
 *
 * The general path-follower behind scripted patrols and on-rails movers (e.g.
 * tower-defense creeps that walk a fixed lane rather than chase). `ai-patrol`
 * builds on the same idea with ping-pong + dwell semantics.
 *
 * Params:
 *  - `points`: array of `{ x, y }` waypoints (structural)
 *  - `speed`: travel speed in px/sec (balance → `$cfg`)
 *  - `arriveRadius`: distance at which a waypoint counts as reached (structural; default 4)
 *  - `loop`: restart from the first point at the end (default false)
 */
export const followPath: BehaviorFn = (entity, world, params, dt) => {
  const wps = points(params, "points");
  const speed = num(params, "speed", 0);
  const arriveRadius = num(params, "arriveRadius", 4);
  const loop = bool(params, "loop", false);

  if (wps.length === 0) {
    entity.vx = 0;
    entity.vy = 0;
    return;
  }

  let i = (entity.state.__wp as number) ?? 0;
  if (i >= wps.length) {
    entity.vx = 0;
    entity.vy = 0;
    return;
  }

  const target = wps[i]!;
  const dx = target.x - entity.cx;
  const dy = target.y - entity.cy;

  if (Math.hypot(dx, dy) <= arriveRadius) {
    i += 1;
    if (i >= wps.length) {
      if (loop) i = 0;
      else {
        entity.state.__wp = i;
        entity.vx = 0;
        entity.vy = 0;
        world.events.emit("path-complete", { id: entity.id });
        return;
      }
    }
    entity.state.__wp = i;
  } else {
    entity.state.__wp = i;
  }

  const dir = normalize({ x: dx, y: dy });
  applyVelocity(entity, dir.x * speed, dir.y * speed, 0, dt);
};
