import type { BehaviorFn } from "@gitcade/sdk";
import { num, strArray, str } from "@gitcade/sdk";

/**
 * Side-scrolling platformer locomotion: horizontal run control, constant gravity,
 * a jump with adjustable strength, and coyote-time (a short grace window after
 * leaving a ledge during which a jump still registers). "Grounded" is true when
 * resting on the world floor OR touching an entity tagged `groundTag` from above.
 * SETS velocity each tick — order a `velocity` behavior AFTER this one.
 *
 * Params:
 *  - `moveSpeed`: horizontal run speed in px/sec (balance → `$cfg`)
 *  - `gravity`: downward acceleration in px/sec² (balance → `$cfg`)
 *  - `jumpSpeed`: upward launch velocity in px/sec (balance → `$cfg`)
 *  - `coyoteTime`: post-ledge jump grace in seconds (balance → `$cfg`; default 0)
 *  - `maxFall`: terminal fall speed in px/sec (balance → `$cfg`; default 0 = uncapped)
 *  - `left`/`right`/`jump`: key-code arrays (defaults: arrows/WASD + Space)
 *  - `groundTag`: tag of solid ground entities (default `"ground"`)
 */
export const movePlatformer: BehaviorFn = (entity, world, params, dt) => {
  const moveSpeed = num(params, "moveSpeed", 0);
  const gravity = num(params, "gravity", 0);
  const jumpSpeed = num(params, "jumpSpeed", 0);
  const coyote = num(params, "coyoteTime", 0);
  const maxFall = num(params, "maxFall", 0);
  const left = orDefault(strArray(params, "left"), ["ArrowLeft", "KeyA"]);
  const right = orDefault(strArray(params, "right"), ["ArrowRight", "KeyD"]);
  const jump = orDefault(strArray(params, "jump"), ["Space", "ArrowUp", "KeyW"]);
  const groundTag = str(params, "groundTag", "ground");

  // Horizontal control.
  entity.vx = world.input.axis(left, right) * moveSpeed;

  // Grounded test: on the floor, or standing on a ground entity moving downward.
  const onFloor = entity.y + entity.h >= world.bounds.height && entity.vy >= 0;
  const onGround = onFloor || entity.collisions.some((o) => o.hasTag(groundTag) && entity.cy <= o.cy && entity.vy >= 0);

  let coyoteLeft = (entity.state.__coyote as number) ?? 0;
  coyoteLeft = onGround ? coyote : Math.max(0, coyoteLeft - dt);
  entity.state.__coyote = coyoteLeft;

  // Jump on a fresh press while grounded or within the coyote window.
  const jumpHeld = world.input.anyDown(jump);
  const jumpPrev = (entity.state.__jumpPrev as boolean) ?? false;
  if (jumpHeld && !jumpPrev && (onGround || coyoteLeft > 0)) {
    entity.vy = -jumpSpeed;
    entity.state.__coyote = 0;
    world.audio.play("jump");
  }
  entity.state.__jumpPrev = jumpHeld;

  // Gravity.
  entity.vy += gravity * dt;
  if (maxFall > 0 && entity.vy > maxFall) entity.vy = maxFall;
  if (onFloor && entity.vy > 0) {
    entity.vy = 0;
    entity.y = world.bounds.height - entity.h;
  }
};

function orDefault(value: string[], fallback: string[]): string[] {
  return value.length ? value : fallback;
}
