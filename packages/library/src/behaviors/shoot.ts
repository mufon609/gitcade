import type { BehaviorFn } from "@gitcade/sdk";
import { num, str, strArray, bool } from "@gitcade/sdk";
import { SHOOT } from "../channels.js";
import { vec2, normalize, toward, spawnFrom } from "../util.js";

/**
 * Fire projectiles on a cooldown — on key press, or automatically. Spawns a clone
 * of the `projectile` entity-definition, launches it at `projectileSpeed` in a
 * fixed `direction`, or aimed at the nearest entity tagged `aimTag`. The
 * projectile carries its own behaviors (typically `velocity` + `contact-damage` +
 * `health-and-death` with a `lifespan`), so this part only handles the firing
 * cadence and launch vector.
 *
 * Params:
 *  - `projectile`: entity-definition to spawn (its `$cfg` refs resolve at spawn)
 *  - `projectileSpeed`: launch speed in px/sec (balance → `$cfg`)
 *  - `cooldown`: seconds between shots (balance → `$cfg`)
 *  - `fireKeys`: key-code array that triggers a shot (default `["Space"]`)
 *  - `auto`: fire continuously without input (default false)
 *  - `direction`: `{ x, y }` launch vector when not aiming (structural; default `{0,-1}` = up)
 *  - `aimTag`: aim at the nearest entity with this tag instead of `direction` (optional)
 *  - `spawnOffset`: `{ x, y }` offset from this entity's center (structural; default `{0,0}`)
 *  - `sound`: sound key on fire (default `"shoot"`)
 */
export const shoot: BehaviorFn = (entity, world, params, _dt, scratch) => {
  const s = scratch!; // per-instance scratch (host-provided): fire cooldown
  const speed = num(params, "projectileSpeed", 0);
  const cooldown = num(params, "cooldown", 0);
  const fireKeys = orDefault(strArray(params, "fireKeys"), ["Space"]);
  const auto = bool(params, "auto", false);
  const aimTag = str(params, "aimTag", "");
  const offset = vec2(params, "spawnOffset", { x: 0, y: 0 });
  const sound = str(params, "sound", "shoot");

  const last = (s.shootCd as number) ?? -Infinity;
  if (world.time < last + cooldown) return;
  if (!auto && !world.input.anyDown(fireKeys)) return;

  // Launch direction: aimed, or the fixed param direction.
  let dir = vec2(params, "direction", { x: 0, y: -1 });
  if (aimTag) {
    const target = world.nearest(entity, aimTag);
    if (!target) return;
    dir = toward(entity, target);
  }
  const unit = normalize(dir);
  if (unit.x === 0 && unit.y === 0) return;

  s.shootCd = world.time;
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
    SHOOT.emit(world, { source: entity.id, projectile: bullet.id });
  }
};

function orDefault(value: string[], fallback: string[]): string[] {
  return value.length ? value : fallback;
}
