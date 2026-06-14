import type { Registry, BehaviorFn } from "@gitcade/sdk";
import { num, strArray, str } from "@gitcade/sdk";

/**
 * `thrust-lift` — the one mechanic a one-button flyer needs that no
 * @gitcade/library part provides: hold a key (or the touch button, which
 * synthesizes that key) to accelerate UP against a constant gravity, release to
 * fall. Clamps the vertical speed both ways. Sets `entity.vy` for a following SDK
 * `velocity` integrator; horizontal position is fixed (the world scrolls past).
 *
 * Written param-driven — all balance via `$cfg`, no magic numbers — and logged in
 * games/LIBRARY-GAPS.md as a generalization candidate ("one-axis thrust /
 * flappy-style control"), since auto-scrollers and jetpack games all want it.
 *
 * Params:
 *  - `thrustKeys`: key codes that lift (default `["Space"]`)
 *  - `thrust`: upward acceleration in px/sec² (balance → `$cfg`)
 *  - `gravity`: downward acceleration in px/sec² (balance → `$cfg`)
 *  - `maxUp` / `maxDown`: vertical speed clamps in px/sec (balance → `$cfg`)
 *  - `flagKey`: a `world.state` boolean that also triggers lift (touch fallback; default `"thrust"`)
 */
export const thrustLift: BehaviorFn = (entity, world, params, dt) => {
  const keys = strArray(params, "thrustKeys");
  const lifting =
    world.input.anyDown(keys.length ? keys : ["Space"]) ||
    world.state[str(params, "flagKey", "thrust")] === true;

  entity.vy += (lifting ? -num(params, "thrust", 0) : num(params, "gravity", 0)) * dt;

  const maxUp = num(params, "maxUp", 0);
  const maxDown = num(params, "maxDown", 0);
  if (entity.vy < -maxUp) entity.vy = -maxUp;
  if (entity.vy > maxDown) entity.vy = maxDown;
};

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerBehavior("thrust-lift", thrustLift);
}
