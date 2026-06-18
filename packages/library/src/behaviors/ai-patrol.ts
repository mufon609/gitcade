import type { BehaviorFn } from "@gitcade/sdk";
import { num, bool } from "@gitcade/sdk";
import { points, normalize } from "../util.js";

/**
 * Patrol between waypoints, dwelling at each for `waitTime`. Unlike `follow-path`
 * (a one-shot or looping courier), a patroller ping-pongs back and forth by
 * default and pauses at each end — the classic guard/sentry pattern. SETS
 * velocity; order a `velocity` behavior AFTER it. Waypoints are structural
 * geometry; `speed` and `waitTime` are balance.
 *
 * Params:
 *  - `points`: array of `{ x, y }` patrol waypoints (structural)
 *  - `speed`: patrol speed in px/sec (balance → `$cfg`)
 *  - `waitTime`: dwell time at each waypoint in seconds (balance → `$cfg`; default 0)
 *  - `pingPong`: reverse at the ends instead of looping (default true)
 *  - `arriveRadius`: distance at which a waypoint counts as reached (structural; default 4)
 */
export const aiPatrol: BehaviorFn = (entity, world, params, dt, scratch) => {
  const s = scratch!; // per-instance scratch (host-provided): waypoint index, step dir, wait timer
  const wps = points(params, "points");
  const speed = num(params, "speed", 0);
  const waitTime = num(params, "waitTime", 0);
  const pingPong = bool(params, "pingPong", true);
  const arriveRadius = num(params, "arriveRadius", 4);

  if (wps.length === 0) {
    entity.vx = 0;
    entity.vy = 0;
    return;
  }

  let i = (s.patrolIdx as number) ?? 0;
  let step = (s.patrolStep as number) ?? 1;
  let waiting = (s.patrolWait as number) ?? 0;

  if (waiting > 0) {
    s.patrolWait = Math.max(0, waiting - dt);
    entity.vx = 0;
    entity.vy = 0;
    return;
  }

  const target = wps[Math.min(i, wps.length - 1)]!;
  const dx = target.x - entity.cx;
  const dy = target.y - entity.cy;

  if (Math.hypot(dx, dy) <= arriveRadius) {
    if (pingPong) {
      if (i + step >= wps.length || i + step < 0) step = -step;
      i += step;
    } else {
      i = (i + 1) % wps.length;
    }
    s.patrolIdx = i;
    s.patrolStep = step;
    s.patrolWait = waitTime;
    entity.vx = 0;
    entity.vy = 0;
    return;
  }

  const dir = normalize({ x: dx, y: dy });
  entity.vx = dir.x * speed;
  entity.vy = dir.y * speed;
};
