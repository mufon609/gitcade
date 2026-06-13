import type { BehaviorFn, Entity } from "@gitcade/sdk";
import { num, str, bool } from "@gitcade/sdk";

/**
 * Deal damage to overlapping entities carrying `targetTag`. Attached to anything
 * that hurts on touch: enemies, hazards, bullets, lobbed bombs. Reduces the
 * victim's `damageKey` state (default `"hp"`) — pair the victim with
 * `health-and-death`, which seeds and watches that value. Requires the SDK
 * `aabb-collision` system to have paired the relevant tags this tick.
 *
 * One of the four REUSE-PROOF parts: enemies damage the player (snake/arena),
 * creeps damage the core (tower-defense), invaders/bullets trade damage
 * (space-invaders). Per-target `cooldown` makes it equally a continuous aura or a
 * one-shot projectile (`selfDestruct`).
 *
 * Robustness: a victim whose `damageKey` is not yet a number (its
 * `health-and-death` has not run its first tick) is skipped — collisions persist
 * while overlapping, so the hit simply lands one tick later once hp is seeded.
 * This avoids an `undefined - damage = NaN` that would make a victim unkillable.
 *
 * Params:
 *  - `targetTag`: tag of entities to damage
 *  - `damage`: hit points removed per hit (balance → `$cfg`)
 *  - `cooldown`: seconds before the same target can be hit again (balance → `$cfg`; default 0 = every tick)
 *  - `damageKey`: victim state key to reduce (default `"hp"`)
 *  - `knockback`: impulse applied to the victim away from this entity (balance → `$cfg`; default 0)
 *  - `selfDestruct`: destroy this entity after a successful hit (default false — for bullets)
 *  - `sound`: sound key on a successful hit (default `"hit"`)
 */
export const contactDamage: BehaviorFn = (entity, world, params) => {
  const targetTag = str(params, "targetTag");
  const damage = num(params, "damage", 0);
  const cooldown = num(params, "cooldown", 0);
  const damageKey = str(params, "damageKey", "hp");
  const knockback = num(params, "knockback", 0);
  const selfDestruct = bool(params, "selfDestruct", false);
  const sound = str(params, "sound", "hit");

  const cds = (entity.state.__dmgCd ??= {}) as Record<string, number>;
  let hitSomething = false;

  for (const other of entity.collisions) {
    if (!other.alive || !other.hasTag(targetTag)) continue;
    // Skip victims whose hp has not been seeded yet (see TSDoc) — never NaN it.
    if (typeof other.state[damageKey] !== "number") continue;
    if (cooldown > 0 && world.time < (cds[other.id] ?? -Infinity) + cooldown) continue;

    cds[other.id] = world.time;
    other.state[damageKey] = (other.state[damageKey] as number) - damage;
    if (knockback > 0) applyKnockback(entity, other, knockback);
    world.events.emit("damage", { source: entity.id, target: other.id, amount: damage });
    hitSomething = true;
  }

  if (hitSomething) {
    world.audio.play(sound);
    if (selfDestruct) world.destroy(entity);
  }
};

function applyKnockback(from: Entity, to: Entity, impulse: number): void {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const len = Math.hypot(dx, dy) || 1;
  to.vx += (dx / len) * impulse;
  to.vy += (dy / len) * impulse;
}
