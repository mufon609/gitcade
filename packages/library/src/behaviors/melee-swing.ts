import type { BehaviorFn } from "@gitcade/sdk";
import { num, strArray, str, bool } from "@gitcade/sdk";
import { vec2, spawnFrom } from "../util.js";

/**
 * A close-range melee attack: on a cooldown'd key press, spawn a short-lived
 * hitbox entity in the facing direction. The hitbox is just another entity
 * (typically `contact-damage` + `health-and-death` with a small `lifespan`), so
 * the damage and the auto-despawn reuse existing parts rather than special-casing
 * a weapon. Facing is read from the wielder's velocity sign, defaulting to the
 * `reach` direction.
 *
 * Params:
 *  - `hitbox`: entity-definition for the transient strike volume
 *  - `cooldown`: seconds between swings (balance → `$cfg`)
 *  - `attackKeys`: key-code array that triggers a swing (default `["KeyJ", "KeyZ"]`)
 *  - `auto`: swing continuously without input (default false)
 *  - `reach`: `{ x, y }` offset of the hitbox from the wielder's center (structural; default `{24,0}`)
 *  - `faceVelocity`: place the hitbox in the wielder's movement direction (default true)
 *  - `sound`: sound key on swing (default `"hit"`)
 */
export const meleeSwing: BehaviorFn = (entity, world, params) => {
  const cooldown = num(params, "cooldown", 0);
  const attackKeys = orDefault(strArray(params, "attackKeys"), ["KeyJ", "KeyZ"]);
  const auto = bool(params, "auto", false);
  const reach = vec2(params, "reach", { x: 24, y: 0 });
  const faceVelocity = bool(params, "faceVelocity", true);
  const sound = str(params, "sound", "hit");

  const last = (entity.state.__meleeCd as number) ?? -Infinity;
  if (world.time < last + cooldown) return;
  if (!auto && !world.input.anyDown(attackKeys)) return;

  let ox = reach.x;
  let oy = reach.y;
  if (faceVelocity && (entity.vx !== 0 || entity.vy !== 0)) {
    const mag = Math.hypot(reach.x, reach.y) || Math.hypot(entity.vx, entity.vy);
    const len = Math.hypot(entity.vx, entity.vy) || 1;
    ox = (entity.vx / len) * mag;
    oy = (entity.vy / len) * mag;
  }

  entity.state.__meleeCd = world.time;
  const hit = spawnFrom(world, params.hitbox, {
    idPrefix: `${entity.id}.swing`,
    position: { x: entity.cx + ox, y: entity.cy + oy },
    state: { __owner: entity.id },
  });
  if (hit) {
    // The spawn position is the strike center; entity coords are top-left, so center it.
    hit.x -= hit.w / 2;
    hit.y -= hit.h / 2;
    world.audio.play(sound);
    world.events.emit("melee", { source: entity.id, hitbox: hit.id });
  }
};

function orDefault(value: string[], fallback: string[]): string[] {
  return value.length ? value : fallback;
}
