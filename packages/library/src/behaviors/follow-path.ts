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
export const followPath: BehaviorFn = (entity, world, params, dt, scratch) => {
  const s = scratch!; // per-instance scratch (host-provided): the waypoint index
  const wps = points(params, "points");
  const speed = num(params, "speed", 0);
  const arriveRadius = num(params, "arriveRadius", 4);
  const loop = bool(params, "loop", false);

  if (wps.length === 0) {
    entity.vx = 0;
    entity.vy = 0;
    return;
  }

  let i = (s.wp as number) ?? 0;
  if (i >= wps.length) {
    entity.vx = 0;
    entity.vy = 0;
    return;
  }

  const target = wps[i]!;
  const dx = target.x - entity.cx;
  const dy = target.y - entity.cy;

  // Arrival gate on SQUARED distance — deterministic, sqrt-free (the magnitude isn't needed).
  if (dx * dx + dy * dy <= arriveRadius * arriveRadius) {
    i += 1;
    if (i >= wps.length) {
      if (loop) i = 0;
      else {
        s.wp = i;
        entity.vx = 0;
        entity.vy = 0;
        world.events.emit("path-complete", { id: entity.id });
        return;
      }
    }
    s.wp = i;
  } else {
    s.wp = i;
  }

  // Maintain a monotonic cumulative-distance metric so other parts can rank movers
  // by how far ALONG the path they are. `s.wp` (waypoint index) doesn't
  // discriminate on a long segment — every creep between two waypoints shares the
  // same index — so `ai-aim-and-fire`'s "first" targeting (`priorityKey:
  // "__pathProgress"`) needs this continuous value, not the integer index.
  entity.state.__pathProgress = ((entity.state.__pathProgress as number) ?? 0) + speed * dt;

  const dir = normalize({ x: dx, y: dy });
  applyVelocity(entity, dir.x * speed, dir.y * speed, 0, dt);
};
