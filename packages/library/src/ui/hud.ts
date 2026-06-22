import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `hud-bar` — a per-entity BEHAVIOR that resizes a flat rectangle to reflect a state
 * number (health, energy, boss hp, progress) read from `world.state` or — with
 * `valueEntity` — a tracked entity's own state. The entity itself is an ordinary
 * `shape` rect placed by the HUD widget definition; this behavior just drives its width
 * each tick from `value / max`, anchored at its left edge. Text HUD widgets (score,
 * timer, wave) need no behavior at all — they are `text` sprites with a live `bind` to a
 * state key (an SDK-frozen sprite feature), so only the bar needs code.
 *
 * Params:
 *  - `valueKey`: state key holding the current value (default `"hp"`)
 *  - `valueEntity`: optional entity id OR tag — read the value from THAT entity's
 *    `state[valueKey]` (e.g. a player's hp) instead of `world.state[valueKey]`. Unset ⇒
 *    the `world.state` read, byte-for-byte. (Max still comes from `world.state`.)
 *  - `max`: full-bar value (balance → `$cfg`; default 1)
 *  - `maxKey`: optional world.state key holding the max (overrides `max` when set)
 *  - `width`: full-bar width in px (structural; the entity's authored width)
 *  - `lowColor` / `lowThreshold`: optional recolor when the ratio drops below it
 */
export const hudBar: BehaviorFn = (entity, world, params) => {
  const valueKey = str(params, "valueKey", "hp");
  // `valueEntity` (id OR tag) sources the value from that entity's own state — the
  // entity→HUD bridge a stringifying `format-binding` can't provide. Same id/tag
  // resolution as `format-binding`'s `fromEntity` read.
  const valueEntity = str(params, "valueEntity", "");
  const src = valueEntity ? (world.byId(valueEntity) ?? world.query(valueEntity)[0])?.state : world.state;
  const value = toNum(src?.[valueKey]);
  const maxKey = str(params, "maxKey", "");
  const max = maxKey ? toNum(world.state[maxKey], num(params, "max", 1)) : num(params, "max", 1);
  const fullWidth = (entity.state.__hudFull as number) ?? (entity.state.__hudFull = entity.w);
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  entity.w = Math.max(0, fullWidth * ratio);

  const lowColor = str(params, "lowColor", "");
  if (lowColor && entity.sprite.kind === "shape") {
    const baseColor = (entity.state.__hudColor as string) ?? (entity.state.__hudColor = entity.sprite.color);
    entity.sprite.color = ratio <= num(params, "lowThreshold", 0.3) ? lowColor : baseColor;
  }
};

function toNum(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}
