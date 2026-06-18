import type { BehaviorFn, Entity, SheetSprite } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `sprite-state-machine` — data-driven platformer animation (INDIE-ROADMAP Tier-1). Maps
 * an entity's MOTION STATE (grounded / horizontal speed / vertical direction) to a named
 * `sheet` animation each tick and advances its frames, so a sprite switches idle → run →
 * jump → fall → land with no hand-wired `play` param. The grounded test reads the Tier-0
 * contact flag `state.__onGround` (set by `tilemap-collide` / `solid-collide`), so it
 * tracks tile floors and solid bodies for free; `vx`/`vy` come from the mover. No-op for a
 * non-`sheet` sprite.
 *
 * State → clip (each clip name is a param, defaulting to a conventional name; set one to
 * `""` to disable that state and fall back):
 *  - grounded + |vx| ≤ `moveThreshold` → `idle`
 *  - grounded + |vx| > `moveThreshold` → `run`
 *  - airborne + `vy < 0` (rising) → `jump` (or `fall`/run/idle if `jump` is unset)
 *  - airborne + `vy ≥ 0` (falling) → `fall` (or run/idle if `fall` is unset)
 *  - airborne → grounded transition → `land`, played ONCE (a non-looping one-shot): it
 *    holds until its clip finishes, then control returns to idle/run. Set `land` to `""`
 *    to skip it.
 *
 * Pure per-tick read + writes to `entity.anim` (and its own `__sm*` scratch keys); no RNG
 * or I/O, so determinism + the frozen tick order are preserved. Order it AFTER the
 * resolvers so it reads this tick's `__onGround` (a one-tick-stale read is harmless — the
 * states are visual). Pair with `face-velocity` for left/right flip. The renderer draws
 * `entity.anim.frame`; advancement mirrors the built-in `sprite-animate`, but the clip is
 * chosen from state instead of a static param.
 *
 * Params (clip names are structural; `moveThreshold` is balance → `$cfg`):
 *  - `idle`/`run`/`jump`/`fall`/`land`: animation names (defaults `"idle"`/`"run"`/
 *    `"jump"`/`"fall"`/`"land"`; `""` disables that state)
 *  - `moveThreshold`: `|vx|` (px/sec) above which the entity is "running" (default 1)
 */
export const spriteStateMachine: BehaviorFn = (entity, _world, params, dt) => {
  if (entity.sprite.kind !== "sheet") return;
  const sheet = entity.sprite as SheetSprite;

  const idle = str(params, "idle", "idle");
  const run = str(params, "run", "run");
  const jump = str(params, "jump", "jump");
  const fall = str(params, "fall", "fall");
  const land = str(params, "land", "land");
  const moveThreshold = num(params, "moveThreshold", 1);

  const grounded = entity.state.__onGround === true;
  const wasAirborne = entity.state.__smAir === true;
  const moving = Math.abs(entity.vx) > moveThreshold;
  const grounderClip = moving ? run : idle;

  // A `land` one-shot is mid-play while it's the active clip and hasn't finished yet
  // (`__smDone`, set by the advance below when a non-looping clip reaches its last frame).
  const playing = entity.state.__smClip as string | undefined;
  const landActive = land !== "" && playing === land && entity.state.__smDone !== true;

  let target: string;
  if (landActive) {
    target = land; // hold the landing animation until it completes
  } else if (grounded && wasAirborne && land !== "") {
    target = land; // just touched down → fire the one-shot
  } else if (!grounded) {
    target = entity.vy < 0 && jump !== "" ? jump : fall !== "" ? fall : grounderClip;
  } else {
    target = grounderClip;
  }

  entity.state.__smDone = advanceClip(entity, sheet, target, dt);
  entity.state.__smClip = target;
  entity.state.__smAir = !grounded;
};

/**
 * Advance `entity.anim` for the named clip by `dt`, returning true when a NON-looping
 * clip has reached its final frame (the one-shot "finished" signal). Resets to the clip's
 * first frame when the clip changes. Mirrors the built-in `sprite-animate` advancement so
 * the two read identically; kept local so this library part needs no SDK change.
 */
function advanceClip(entity: Entity, sheet: SheetSprite, clipName: string, dt: number): boolean {
  let from = 0;
  let to = sheet.frameCount - 1;
  let fps = sheet.fps;
  let loop = true;
  const a = clipName ? sheet.animations?.[clipName] : undefined;
  if (a) {
    from = a.from;
    to = a.to;
    fps = a.fps ?? sheet.fps;
    loop = a.loop;
  }

  if (entity.anim.current !== clipName) {
    entity.anim.current = clipName;
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
    if (loop) {
      entity.anim.frame = from + ((entity.anim.frame - from) % span);
    } else {
      entity.anim.frame = to;
      return true; // non-looping clip finished
    }
  }
  return false;
}
