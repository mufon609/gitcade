import type { BehaviorFn, SheetSprite } from "@gitcade/sdk";
import { num, str, advanceAnim } from "@gitcade/sdk";

/**
 * `sprite-state-machine` — data-driven platformer animation (INDIE-ROADMAP Tier-1). Maps
 * an entity's MOTION STATE (grounded / horizontal speed / vertical direction) to a named
 * `sheet` animation each tick and advances its frames, so a sprite switches idle → run →
 * jump → fall → land with no hand-wired `play` param. The grounded test reads the typed
 * contact flag `entity.body.contacts.onGround` (set by `tilemap-collide` / `solid-collide`), so
 * it tracks tile floors and solid bodies for free; `vx`/`vy` come from the mover. No-op for
 * a non-`sheet` sprite.
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
 * Pure per-tick read + writes to `entity.anim` (and its own per-instance `scratch`); no RNG
 * or I/O, so determinism + the frozen tick order are preserved. Order it AFTER the
 * resolvers so it reads this tick's `contacts.onGround` (a one-tick-stale read is harmless —
 * the states are visual). Pair with `face-velocity` for left/right flip. The renderer draws
 * `entity.anim.frame`; advancement mirrors the built-in `sprite-animate`, but the clip is
 * chosen from state instead of a static param.
 *
 * Params (clip names are structural; `moveThreshold` is balance → `$cfg`):
 *  - `idle`/`run`/`jump`/`fall`/`land`: animation names (defaults `"idle"`/`"run"`/
 *    `"jump"`/`"fall"`/`"land"`; `""` disables that state)
 *  - `moveThreshold`: `|vx|` (px/sec) above which the entity is "running" (default 1)
 */
export const spriteStateMachine: BehaviorFn = (entity, _world, params, dt, scratch) => {
  if (entity.sprite.kind !== "sheet") return;
  const sheet = entity.sprite as SheetSprite;
  const s = scratch!; // this instance's private state (air flag, current clip, one-shot-done)

  const idle = str(params, "idle", "idle");
  const run = str(params, "run", "run");
  const jump = str(params, "jump", "jump");
  const fall = str(params, "fall", "fall");
  const land = str(params, "land", "land");
  const moveThreshold = num(params, "moveThreshold", 1);

  const grounded = entity.body.contacts.onGround;
  const wasAirborne = s.smAir === true;
  const moving = Math.abs(entity.vx) > moveThreshold;
  const grounderClip = moving ? run : idle;

  // A `land` one-shot is mid-play while it's the active clip and hasn't finished yet
  // (`s.smDone`, set by the advance below when a non-looping clip reaches its last frame).
  const playing = s.smClip as string | undefined;
  const landActive = land !== "" && playing === land && s.smDone !== true;

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

  // Advance via the shared SDK primitive (the same code `sprite-animate` runs), so a
  // state-driven clip and a static `play` clip advance byte-identically; `s.smDone` captures
  // its one-shot "finished" signal so a non-looping `land` holds until it completes.
  s.smDone = advanceAnim(entity.anim, sheet, target, dt);
  s.smClip = target;
  s.smAir = !grounded;
};
