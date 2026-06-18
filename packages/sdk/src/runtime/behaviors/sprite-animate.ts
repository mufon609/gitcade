import type { BehaviorFn } from "../types.js";
import { num, str } from "../params.js";
import type { SheetSprite } from "../../schema/sprite.js";
import { advanceAnim } from "../anim.js";

/**
 * Advances sprite-sheet animation frames over time (the "sheet animation" half of
 * the sprite-renderer primitive). No-ops for non-sheet sprites. The renderer
 * reads `entity.anim.frame` to draw the correct cell. The frame-advance itself is
 * the shared {@link advanceAnim} primitive (same code the library `sprite-state-machine`
 * runs), so a static `play` clip and a state-driven clip advance identically.
 *
 * Params:
 *  - `play`: named animation from the sheet's `animations` (optional; defaults to
 *    the whole sheet)
 *  - `fps`: playback rate override (structural)
 */
export const spriteAnimate: BehaviorFn = (entity, _world, params, dt) => {
  if (entity.sprite.kind !== "sheet") return;
  const sheet = entity.sprite as SheetSprite;

  const playName = str(params, "play", "") || null;
  advanceAnim(entity.anim, sheet, playName, dt, num(params, "fps", 0));
};
