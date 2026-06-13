import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * A pickup: when an entity tagged `collectorTag` touches this one, award value
 * and consume it. Optionally credits a score key and/or an inventory/currency key
 * on `world.state`, emits a `"collect"` event (carrying the item kind), and plays
 * a sound. Coins, gems, power-ups, and keys are all this part with different
 * params + sprites. Requires the SDK `aabb-collision` system to pair the tags.
 *
 * Params:
 *  - `collectorTag`: tag of the entity that can collect (e.g. `"player"`)
 *  - `value`: amount awarded (balance → `$cfg`; default 0)
 *  - `scoreKey`: optional `world.state` key to add `value` to (e.g. `"score"`)
 *  - `grantKey`: optional second `world.state` key to add `value` to (e.g. `"coins"`)
 *  - `kind`: label included in the emitted event (default `"item"`)
 *  - `sound`: sound key on pickup (default `"collect"`)
 *  - `consume`: destroy the pickup on collection (default true)
 */
export const collectOnTouch: BehaviorFn = (entity, world, params) => {
  const collectorTag = str(params, "collectorTag", "player");
  const value = num(params, "value", 0);
  const scoreKey = str(params, "scoreKey", "");
  const grantKey = str(params, "grantKey", "");
  const kind = str(params, "kind", "item");

  const collector = entity.collisions.find((o) => o.alive && o.hasTag(collectorTag));
  if (!collector) return;

  if (scoreKey) world.state[scoreKey] = ((world.state[scoreKey] as number) ?? 0) + value;
  if (grantKey) world.state[grantKey] = ((world.state[grantKey] as number) ?? 0) + value;

  world.events.emit("collect", { id: entity.id, kind, value, by: collector.id });
  world.audio.play(str(params, "sound", "collect"));

  if (params.consume !== false) world.destroy(entity);
};
