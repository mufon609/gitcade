import type { AnimationState } from "./entity.js";
import type { SheetSprite } from "../schema/sprite.js";

/**
 * Advance an {@link AnimationState} for one sheet clip by `dt`, returning `true` the tick a
 * NON-looping clip reaches its final frame (the one-shot "finished" signal). The single
 * source of truth for sprite-sheet frame advancement: the built-in `sprite-animate` and the
 * library `sprite-state-machine` both call it, so the two advance byte-identically instead of
 * carrying parallel copies of this loop.
 *
 * `clip` is the clip IDENTITY to play — a name in `sheet.animations`, or `null`/`""` for the
 * whole sheet. When it differs from `anim.current` the playhead resets to the clip's first
 * frame (`anim.current` is set to `clip` verbatim, so a `null` default and a named clip stay
 * distinct identities). `fpsOverride > 0` replaces the clip's fps (structural); pass `0` (the
 * default) to honor the clip/sheet fps.
 *
 * Mutates `anim` in place; reads only `sheet` (frameCount/fps/animations). No RNG or I/O, so
 * it preserves determinism and is safe inside the frozen tick order.
 */
export function advanceAnim(
  anim: AnimationState,
  sheet: SheetSprite,
  clip: string | null,
  dt: number,
  fpsOverride = 0,
): boolean {
  let from = 0;
  let to = sheet.frameCount - 1;
  let fps = sheet.fps;
  let loop = true;
  const a = clip ? sheet.animations?.[clip] : undefined;
  if (a) {
    from = a.from;
    to = a.to;
    fps = a.fps ?? sheet.fps;
    loop = a.loop;
  }
  if (fpsOverride > 0) fps = fpsOverride;

  if (anim.current !== clip) {
    anim.current = clip;
    anim.frame = from;
    anim.elapsed = 0;
  }

  const frameDur = 1 / fps;
  anim.elapsed += dt;
  while (anim.elapsed >= frameDur) {
    anim.elapsed -= frameDur;
    anim.frame += 1;
  }

  const span = to - from + 1;
  if (anim.frame > to) {
    if (loop) {
      anim.frame = from + ((anim.frame - from) % span);
    } else {
      anim.frame = to;
      return true; // non-looping clip finished
    }
  }
  return false;
}
