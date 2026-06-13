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
 */
export const aiAimAndFire: BehaviorFn = (entity, world, params) => {
  const targetTag = str(params, "targetTag");
  const range = num(params, "range", 0);
  const cooldown = num(params, "cooldown", 0);
  const speed = num(params, "projectileSpeed", 0);
  const offset = vec2(params, "spawnOffset", { x: 0, y: 0 });
  const sound = str(params, "sound", "shoot");

  const last = (entity.state.__aimCd as number) ?? -Infinity;
  if (world.time < last + cooldown) return;

  const target = world.nearest(entity, targetTag);
  if (!target) return;
  const delta = toward(entity, target);
  if (range > 0 && length(delta) > range) return;

  const unit = normalize(delta);
  if (unit.x === 0 && unit.y === 0) return;

  entity.state.__aimCd = world.time;
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
