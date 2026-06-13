import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `hud-bar` — a per-entity BEHAVIOR that resizes a flat rectangle to reflect a
 * `world.state` number (health, energy, boss hp, progress). The entity itself is an
 * ordinary `shape` rect placed by the HUD widget definition; this behavior just
 * drives its width each tick from `value / max`, anchored at its left edge. Text
 * HUD widgets (score, timer, wave) need no behavior at all — they are `text` sprites
 * with a live `bind` to a state key (an SDK-frozen sprite feature), so only the bar
 * needs code.
 *
 * Params:
 *  - `valueKey`: world.state key holding the current value (default `"hp"`)
 *  - `max`: full-bar value (balance → `$cfg`; default 1)
 *  - `maxKey`: optional world.state key holding the max (overrides `max` when set)
 *  - `width`: full-bar width in px (structural; the entity's authored width)
 *  - `lowColor` / `lowThreshold`: optional recolor when the ratio drops below it
 */
export const hudBar: BehaviorFn = (entity, world, params) => {
  const value = toNum(world.state[str(params, "valueKey", "hp")]);
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
