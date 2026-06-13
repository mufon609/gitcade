import type { BehaviorFn } from "../types.js";
import { num, str, strArray, bool } from "../params.js";

/**
 * Input-mapping primitive (keyboard + touch). Drives one velocity axis from two
 * key groups, and — when no key is held and `touch` is enabled — from the active
 * pointer position relative to the entity (move toward the finger). This is what
 * makes a paddle controllable by both arrow keys and a touch screen.
 *
 * Params:
 *  - `axis`: `"x"` | `"y"` (default `"y"`)
 *  - `neg`, `pos`: arrays of `KeyboardEvent.code` values for the −/+ directions
 *  - `speed`: movement speed in px/sec (balance → `$cfg`)
 *  - `touch`: enable pointer control (default true)
 */
export const keyboardAxis: BehaviorFn = (entity, world, params) => {
  const axis = str(params, "axis", "y") === "x" ? "x" : "y";
  const neg = strArray(params, "neg");
  const pos = strArray(params, "pos");
  const speed = num(params, "speed", 0);
  const touch = bool(params, "touch", true);

  let dir = world.input.axis(neg, pos);

  if (dir === 0 && touch) {
    const pointers = world.input.activePointers();
    if (pointers.length > 0) {
      const p = pointers[0]!;
      const target = axis === "y" ? p.y : p.x;
      const center = axis === "y" ? entity.cy : entity.cx;
      const DEADZONE_PX = 4; // structural, source-level — not a balance value
      if (Math.abs(target - center) > DEADZONE_PX) dir = Math.sign(target - center);
    }
  }

  if (axis === "y") entity.vy = dir * speed;
  else entity.vx = dir * speed;
};
