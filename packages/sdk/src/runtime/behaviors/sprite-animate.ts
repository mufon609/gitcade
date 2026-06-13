import type { BehaviorFn } from "../types.js";
import { num, str } from "../params.js";
import type { SheetSprite } from "../../schema/sprite.js";

/**
 * Advances sprite-sheet animation frames over time (the "sheet animation" half of
 * the sprite-renderer primitive). No-ops for non-sheet sprites. The renderer
 * reads `entity.anim.frame` to draw the correct cell.
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
  let from = 0;
  let to = sheet.frameCount - 1;
  let fps = sheet.fps;
  let loop = true;

  if (playName && sheet.animations?.[playName]) {
    const a = sheet.animations[playName]!;
    from = a.from;
    to = a.to;
    fps = a.fps ?? sheet.fps;
    loop = a.loop;
  }
  const fpsOverride = num(params, "fps", 0);
  if (fpsOverride > 0) fps = fpsOverride;

  if (entity.anim.current !== playName) {
    entity.anim.current = playName;
    entity.anim.frame = from;
    entity.anim.elapsed = 0;
  }

  const frameDur = 1 / fps;
  entity.anim.elapsed += dt;
  while (entity.anim.elapsed >= frameDur) {
    entity.anim.elapsed -= frameDur;
    entity.anim.frame += 1;
  }
  const span = to - from + 1;
  if (entity.anim.frame > to) {
    entity.anim.frame = loop ? from + ((entity.anim.frame - from) % span) : to;
  }
};
