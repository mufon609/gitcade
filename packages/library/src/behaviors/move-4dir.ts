import type { BehaviorFn } from "@gitcade/sdk";
import { num, strArray, bool } from "@gitcade/sdk";
import { applyVelocity } from "../util.js";

/**
 * Four-directional keyboard movement (up/down/left/right). SETS velocity each
 * tick from the held keys — order a `velocity` behavior AFTER this one. Defaults
 * cover both arrow keys and WASD so a freshly-composed entity is immediately
 * controllable on desktop; touch d-pad support arrives with the Phase 2B UI part.
 *
 * Params:
 *  - `speed`: movement speed in px/sec (balance → `$cfg`)
 *  - `up`/`down`/`left`/`right`: arrays of `KeyboardEvent.code` (defaults: arrows + WASD)
 *  - `normalizeDiagonal`: scale diagonal speed to match cardinal speed (default false)
 *  - `accel`: optional acceleration in px/sec² (balance → `$cfg`; 0 = snap)
 */
export const move4dir: BehaviorFn = (entity, world, params, dt) => {
  const speed = num(params, "speed", 0);
  const up = orDefault(strArray(params, "up"), ["ArrowUp", "KeyW"]);
  const down = orDefault(strArray(params, "down"), ["ArrowDown", "KeyS"]);
  const left = orDefault(strArray(params, "left"), ["ArrowLeft", "KeyA"]);
  const right = orDefault(strArray(params, "right"), ["ArrowRight", "KeyD"]);

  let dx = world.input.axis(left, right);
  let dy = world.input.axis(up, down);

  if (bool(params, "normalizeDiagonal", false) && dx !== 0 && dy !== 0) {
    const inv = 1 / Math.SQRT2;
    dx *= inv;
    dy *= inv;
  }

  applyVelocity(entity, dx * speed, dy * speed, num(params, "accel", 0), dt);
};

function orDefault(value: string[], fallback: string[]): string[] {
  return value.length ? value : fallback;
}
