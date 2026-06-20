import type { BehaviorFn } from "@gitcade/sdk";
import { num, strArray, bool } from "@gitcade/sdk";
import { applyVelocity, normalize } from "../util.js";

/**
 * Top-down movement with normalized 8-direction keyboard control and optional
 * "move toward pointer" steering for touch/mouse. Unlike `move-4dir`, diagonals
 * are always normalized (no faster-on-the-diagonal bug) and a held pointer pulls
 * the entity toward it — the natural control scheme for twin-stick / survival
 * arena players. SETS velocity; order a `velocity` behavior AFTER it.
 *
 * Params:
 *  - `speed`: movement speed in px/sec (balance → `$cfg`)
 *  - `up`/`down`/`left`/`right`: key-code arrays (defaults: arrows + WASD)
 *  - `pointerFollow`: steer toward the active pointer when no key is held (default true)
 *  - `accel`: optional acceleration in px/sec² (balance → `$cfg`; 0 = snap)
 */
export const moveTopdown360: BehaviorFn = (entity, world, params, dt) => {
  const speed = num(params, "speed", 0);
  const up = orDefault(strArray(params, "up"), ["ArrowUp", "KeyW"]);
  const down = orDefault(strArray(params, "down"), ["ArrowDown", "KeyS"]);
  const left = orDefault(strArray(params, "left"), ["ArrowLeft", "KeyA"]);
  const right = orDefault(strArray(params, "right"), ["ArrowRight", "KeyD"]);

  let dx = world.input.axis(left, right);
  let dy = world.input.axis(up, down);

  if (dx === 0 && dy === 0 && bool(params, "pointerFollow", true)) {
    const pointers = world.input.activePointers();
    if (pointers.length > 0) {
      const p = pointers[0]!;
      const pdx = p.x - entity.cx;
      const pdy = p.y - entity.cy;
      const dir = normalize({ x: pdx, y: pdy });
      const DEADZONE_PX = 4; // structural, source-level — not a balance value
      // Deadzone gate on SQUARED distance — deterministic, sqrt-free.
      if (pdx * pdx + pdy * pdy > DEADZONE_PX * DEADZONE_PX) {
        dx = dir.x;
        dy = dir.y;
      }
    }
  } else if (dx !== 0 || dy !== 0) {
    const dir = normalize({ x: dx, y: dy });
    dx = dir.x;
    dy = dir.y;
  }

  applyVelocity(entity, dx * speed, dy * speed, num(params, "accel", 0), dt);
};

function orDefault(value: string[], fallback: string[]): string[] {
  return value.length ? value : fallback;
}
