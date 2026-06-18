import type { BehaviorFn } from "@gitcade/sdk";
import { num, str, bool } from "@gitcade/sdk";

/**
 * Own an entity's hit points and its death. Seeds `state.hp` from the `hp` param
 * on its first tick (so damage dealers have a number to subtract from), counts an
 * optional `lifespan` down, and — when hp reaches 0 or the lifespan expires —
 * emits a death event, plays a sound, optionally tallies a world score key, and
 * destroys the entity.
 *
 * One of the four REUSE-PROOF parts: every mortal thing in all four demos carries
 * it — players, enemies, the tower-defense core, and projectiles. The `lifespan`
 * option is the deliberate GENERALIZATION that lets the same part also expire
 * bullets and melee hitboxes, instead of adding a one-off TTL behavior.
 *
 * Params:
 *  - `hp`: starting hit points (balance → `$cfg`; default 1, only if `state.hp` unset)
 *  - `lifespan`: seconds to live before dying of old age (balance → `$cfg`; default 0 = no limit)
 *  - `deathEvent`: event name emitted on death (default `"death"`)
 *  - `deathSound`: sound key on death (default `"explode"`)
 *  - `tallyKey`: optional `world.state` key incremented on death (e.g. `"kills"`, `"deaths"`)
 *  - `tallyAmount`: amount added to `tallyKey` (balance → `$cfg`; default 1)
 *  - `destroyOnDeath`: remove the entity on death (default true)
 */
export const healthAndDeath: BehaviorFn = (entity, world, params, dt, scratch) => {
  const s = scratch!; // per-instance scratch (host-provided): death latch + lifespan age
  if (s.dead) return;

  if (typeof entity.state.hp !== "number") {
    entity.state.hp = num(params, "hp", 1);
  }

  const lifespan = num(params, "lifespan", 0);
  if (lifespan > 0) {
    s.age = ((s.age as number) ?? 0) + dt;
    if ((s.age as number) >= lifespan) entity.state.hp = 0;
  }

  if ((entity.state.hp as number) > 0) return;

  // --- death ---
  s.dead = true;
  const tallyKey = str(params, "tallyKey", "");
  if (tallyKey) {
    world.state[tallyKey] = ((world.state[tallyKey] as number) ?? 0) + num(params, "tallyAmount", 1);
  }
  world.events.emit(str(params, "deathEvent", "death"), { id: entity.id, tags: [...entity.tags] });
  world.audio.play(str(params, "deathSound", "explode"));
  if (bool(params, "destroyOnDeath", true)) world.destroy(entity);
};
