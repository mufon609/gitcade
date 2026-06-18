import type { BehaviorFn } from "@gitcade/sdk";
import { num, strArray, str } from "@gitcade/sdk";

/**
 * Side-scrolling platformer locomotion: horizontal run control, constant gravity, a jump
 * with adjustable strength, and coyote-time (a short grace window after leaving a ledge
 * during which a jump still registers). "Grounded" is true when resting on the world
 * floor OR touching an entity tagged `groundTag` from above OR marked grounded by a
 * resolver (`state.__onGround`, e.g. `tilemap-collide`/`solid-collide` from a tile floor
 * or a crate). SETS velocity each tick — order a `velocity` behavior AFTER this one.
 *
 * 1.2.0 adds the genre-feel layer as OPTIONAL params, each defaulting to a value that
 * reproduces the original fixed-impulse/instant-velocity behavior exactly (a game that
 * sets none of them is byte-identical):
 *  - **run acceleration/friction** (`accel`/`friction`): ramp `vx` toward the target
 *    instead of snapping to it.
 *  - **variable jump height** (`jumpCutMultiplier`): releasing jump while rising trims the
 *    climb, so a tap is a short hop and a hold is a full jump.
 *  - **jump buffering** (`jumpBuffer`): a press just before landing still fires the jump.
 *  - **apex hang** (`apexGravityMult`/`apexThreshold`): lighter gravity near the top of
 *    the arc for a floatier, more controllable peak.
 *
 * Params:
 *  - `moveSpeed`: horizontal run speed in px/sec (balance → `$cfg`)
 *  - `gravity`: downward acceleration in px/sec² (balance → `$cfg`)
 *  - `jumpSpeed`: upward launch velocity in px/sec (balance → `$cfg`)
 *  - `coyoteTime`: post-ledge jump grace in seconds (balance → `$cfg`; default 0)
 *  - `maxFall`: terminal fall speed in px/sec (balance → `$cfg`; default 0 = uncapped)
 *  - `accel`: horizontal acceleration in px/sec² toward the target speed (balance → `$cfg`;
 *    default 0 = instant `vx`, the original feel)
 *  - `friction`: horizontal deceleration in px/sec² when there is no input (balance → `$cfg`;
 *    default 0 = falls back to `accel`; only applies when `accel > 0`)
 *  - `jumpCutMultiplier`: `vy` is multiplied by this on jump-release while rising (balance →
 *    `$cfg`; default 1 = no cut / fixed-impulse jump)
 *  - `jumpBuffer`: seconds a jump press is remembered so it fires on landing (balance →
 *    `$cfg`; default 0 = off)
 *  - `apexGravityMult`: gravity multiplier while `|vy| < apexThreshold` (balance → `$cfg`;
 *    default 1 = no change)
 *  - `apexThreshold`: `|vy|` (px/sec) under which `apexGravityMult` applies (balance →
 *    `$cfg`; default 0 = off)
 *  - `left`/`right`/`jump`: key-code arrays (defaults: arrows/WASD + Space)
 *  - `groundTag`: tag of solid ground entities (default `"ground"`)
 */
export const movePlatformer: BehaviorFn = (entity, world, params, dt) => {
  const moveSpeed = num(params, "moveSpeed", 0);
  const gravity = num(params, "gravity", 0);
  const jumpSpeed = num(params, "jumpSpeed", 0);
  const coyote = num(params, "coyoteTime", 0);
  const maxFall = num(params, "maxFall", 0);
  const accel = num(params, "accel", 0);
  const friction = num(params, "friction", 0);
  const jumpCut = num(params, "jumpCutMultiplier", 1);
  const jumpBuffer = num(params, "jumpBuffer", 0);
  const apexMult = num(params, "apexGravityMult", 1);
  const apexThreshold = num(params, "apexThreshold", 0);
  const left = orDefault(strArray(params, "left"), ["ArrowLeft", "KeyA"]);
  const right = orDefault(strArray(params, "right"), ["ArrowRight", "KeyD"]);
  const jump = orDefault(strArray(params, "jump"), ["Space", "ArrowUp", "KeyW"]);
  const groundTag = str(params, "groundTag", "ground");

  // Horizontal control. Default (`accel <= 0`) snaps to the target speed — the original
  // instant feel. With `accel > 0`, ramp `vx` toward the target; when there's no input,
  // decay toward rest by `friction` (or `accel` if friction is unset).
  const target = world.input.axis(left, right) * moveSpeed;
  if (accel <= 0) {
    entity.vx = target;
  } else {
    const rate = (target === 0 && friction > 0 ? friction : accel) * dt;
    if (entity.vx < target) entity.vx = Math.min(entity.vx + rate, target);
    else if (entity.vx > target) entity.vx = Math.max(entity.vx - rate, target);
  }

  // Grounded test: on the world floor, OR standing on a `groundTag` entity from above,
  // OR a separate resolver marked us grounded last tick via `state.__onGround` — the
  // 0.7.0 hook that lets the library `tilemap-collide`/`solid-collide` behaviors (ordered
  // AFTER this one) satisfy the jump test off a TILE floor or a solid body without this
  // part knowing about them. Purely additive: with nothing setting `__onGround`, unchanged.
  const onFloor = entity.y + entity.h >= world.bounds.height && entity.vy >= 0;
  const onGround =
    onFloor ||
    entity.state.__onGround === true ||
    entity.collisions.some((o) => o.hasTag(groundTag) && entity.cy <= o.cy && entity.vy >= 0);

  let coyoteLeft = (entity.state.__coyote as number) ?? 0;
  coyoteLeft = onGround ? coyote : Math.max(0, coyoteLeft - dt);
  entity.state.__coyote = coyoteLeft;

  // Jump-buffer timer: a fresh press starts it, then it counts down, so a press up to
  // `jumpBuffer` seconds before landing still fires the jump on the landing tick. Default
  // `jumpBuffer = 0` keeps the timer at 0, so only a same-tick fresh press jumps (original).
  const jumpHeld = world.input.anyDown(jump);
  const jumpPrev = (entity.state.__jumpPrev as boolean) ?? false;
  const freshPress = jumpHeld && !jumpPrev;
  let buffered = (entity.state.__jumpBuf as number) ?? 0;
  buffered = freshPress ? (jumpBuffer > 0 ? jumpBuffer : 0) : Math.max(0, buffered - dt);

  // Jump on a fresh OR buffered press while grounded or within the coyote window.
  if ((freshPress || buffered > 0) && (onGround || coyoteLeft > 0)) {
    entity.vy = -jumpSpeed;
    entity.state.__coyote = 0;
    buffered = 0;
    world.audio.play("jump");
  }
  entity.state.__jumpBuf = buffered;

  // Variable jump height (release-to-cut): releasing jump while still rising trims the
  // upward velocity. Default `jumpCutMultiplier = 1` is a no-op (fixed-impulse jump).
  if (jumpCut < 1 && jumpPrev && !jumpHeld && entity.vy < 0) entity.vy *= jumpCut;
  entity.state.__jumpPrev = jumpHeld;

  // Gravity, with an optional reduced-gravity apex "hang" near the top of the arc (small
  // `|vy|`). Default `apexGravityMult = 1` / `apexThreshold = 0` leaves gravity unchanged.
  const g = apexMult !== 1 && apexThreshold > 0 && Math.abs(entity.vy) < apexThreshold ? gravity * apexMult : gravity;
  entity.vy += g * dt;
  if (maxFall > 0 && entity.vy > maxFall) entity.vy = maxFall;
  if (onFloor && entity.vy > 0) {
    entity.vy = 0;
    entity.y = world.bounds.height - entity.h;
  }
};

function orDefault(value: string[], fallback: string[]): string[] {
  return value.length ? value : fallback;
}
