import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
import { toward, length, normalize, vec2, spawnFrom } from "../util.js";

/**
 * Turret AI: when an entity tagged `targetTag` is within `range`, fire a
 * projectile at it on a cooldown. The aiming/triggering counterpart to the
 * player-driven `shoot` — same projectile-spawning model, but gated on
 * line-of-sight range rather than input. Powers stationary shooter enemies,
 * defensive towers, and sentries.
 *
 * Params:
 *  - `targetTag`: tag of entities to fire at
 *  - `range`: max distance to engage in px (balance → `$cfg`)
 *  - `cooldown`: seconds between shots (balance → `$cfg`)
 *  - `projectile`: entity-definition to spawn
 *  - `projectileSpeed`: launch speed in px/sec (balance → `$cfg`)
 *  - `spawnOffset`: `{ x, y }` muzzle offset from center (structural; default `{0,0}`)
 *  - `sound`: sound key on fire (default `"shoot"`)
 *  - `priorityKey` (1.1.0): when set, choose the in-range target with the HIGHEST
 *    (or lowest) numeric `entity.state[priorityKey]`, distance as tiebreak, instead
 *    of the plain nearest. The tower-defense fix for "shoots the wrong creep":
 *    pair with `follow-path`'s `__pathProgress` for canonical "first" (most-advanced)
 *    targeting, or a creep `hp` state key for "strongest"/"weakest". Unset ⇒ nearest
 *    (byte-identical to 1.0.0).
 *  - `priorityOrder` (1.1.0): `"high"` (default, prefer the largest value) | `"low"`.
 */
export const aiAimAndFire: BehaviorFn = (entity, world, params, _dt, scratch) => {
  const s = scratch!; // per-instance scratch (host-provided): fire cooldown
  const targetTag = str(params, "targetTag");
  const range = num(params, "range", 0);
  const cooldown = num(params, "cooldown", 0);
  const speed = num(params, "projectileSpeed", 0);
  const offset = vec2(params, "spawnOffset", { x: 0, y: 0 });
  const sound = str(params, "sound", "shoot");
  const priorityKey = str(params, "priorityKey", "");

  const last = (s.aimCd as number) ?? -Infinity;
  if (world.time < last + cooldown) return;

  // Target selection: by default the NEAREST tagged entity (1.0.0). With a
  // `priorityKey`, rank the IN-RANGE candidates by that entity-state value
  // (highest, or lowest with `priorityOrder:"low"`) and break ties by distance —
  // so a tower can prefer the most-advanced creep ("first") rather than the closest.
  let target = world.nearest(entity, targetTag);
  if (priorityKey) {
    const preferLow = str(params, "priorityOrder", "high") === "low";
    let best: typeof target;
    let bestVal = 0;
    let bestDist = Infinity;
    for (const c of world.query(targetTag)) {
      if (c === entity) continue;
      const d = length(toward(entity, c));
      if (range > 0 && d > range) continue;
      const v = typeof c.state[priorityKey] === "number" ? (c.state[priorityKey] as number) : 0;
      const better = !best || (preferLow ? v < bestVal : v > bestVal) || (v === bestVal && d < bestDist);
      if (better) {
        best = c;
        bestVal = v;
        bestDist = d;
      }
    }
    target = best;
  }
  if (!target) return;
  const delta = toward(entity, target);
  if (range > 0 && length(delta) > range) return;

  const unit = normalize(delta);
  if (unit.x === 0 && unit.y === 0) return;

  s.aimCd = world.time;
  const bullet = spawnFrom(world, params.projectile, {
    idPrefix: `${entity.id}.shot`,
    position: { x: entity.cx + offset.x, y: entity.cy + offset.y },
  });
  if (bullet) {
    // The spawn position is the muzzle point; entity coords are top-left, so center it.
    bullet.x -= bullet.w / 2;
    bullet.y -= bullet.h / 2;
    bullet.vx = unit.x * speed;
    bullet.vy = unit.y * speed;
    world.audio.play(sound);
    world.events.emit("shoot", { source: entity.id, projectile: bullet.id });
  }
};
