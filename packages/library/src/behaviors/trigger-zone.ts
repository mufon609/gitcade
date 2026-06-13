import type { BehaviorFn } from "@gitcade/sdk";
import { str, bool } from "@gitcade/sdk";

/**
 * A volume that reacts when an entity tagged `tag` overlaps it. Fires an
 * `"enter"` event the first tick an entity arrives (and an `"exit"` event when it
 * leaves), optionally sets a `world.state` flag while occupied, and can destroy
 * entrants (`kill`) to act as a hazard or out-of-bounds line. The generic spatial
 * trigger — checkpoints, doors, kill-planes, scroller hazards — composing damage
 * or teleport via the entities it touches rather than hard-coding an effect.
 *
 * Params:
 *  - `tag`: tag of entities that activate the zone
 *  - `enterEvent`/`exitEvent`: event names (defaults `"enter"`/`"exit"`)
 *  - `setStateKey`: optional `world.state` boolean key, true while occupied
 *  - `kill`: destroy entrants on entry (default false)
 *  - `once`: fire only the first time, then go inert (default false)
 *  - `sound`: sound key on entry (optional)
 */
export const triggerZone: BehaviorFn = (entity, world, params) => {
  if (entity.state.__triggerSpent) return;
  const tag = str(params, "tag");
  const kill = bool(params, "kill", false);
  const once = bool(params, "once", false);
  const enterEvent = str(params, "enterEvent", "enter");
  const exitEvent = str(params, "exitEvent", "exit");
  const setStateKey = str(params, "setStateKey", "");
  const sound = str(params, "sound", "");

  const inside = (entity.state.__inside ??= {}) as Record<string, boolean>;
  const present = new Set<string>();

  for (const other of entity.collisions) {
    if (!other.alive || !other.hasTag(tag)) continue;
    present.add(other.id);
    if (!inside[other.id]) {
      inside[other.id] = true;
      world.events.emit(enterEvent, { zone: entity.id, id: other.id });
      if (sound) world.audio.play(sound);
      if (kill) world.destroy(other);
      if (once) {
        entity.state.__triggerSpent = true;
        if (setStateKey) world.state[setStateKey] = true;
        return;
      }
    }
  }

  // Detect exits.
  for (const id of Object.keys(inside)) {
    if (!present.has(id)) {
      delete inside[id];
      world.events.emit(exitEvent, { zone: entity.id, id });
    }
  }

  if (setStateKey) world.state[setStateKey] = present.size > 0;
};
