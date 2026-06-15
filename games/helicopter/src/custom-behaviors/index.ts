import type { Registry, BehaviorFn } from "@gitcade/sdk";
import { num, strArray } from "@gitcade/sdk";

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
 * 0.2.0 note: the old `flagKey` (a `world.state` boolean touch fallback) was
 * DROPPED — the mobile touch button now synthesizes the same Space keydown/keyup
 * the host already reads (see main.ts), so the key path covers desktop AND touch
 * and the second code path was dead. One fewer param, same feel.
 *
 * Params:
 *  - `thrustKeys`: key codes that lift (default `["Space"]`)
 *  - `thrust`: upward acceleration in px/sec² (balance → `$cfg`)
 *  - `gravity`: downward acceleration in px/sec² (balance → `$cfg`)
 *  - `maxUp` / `maxDown`: vertical speed clamps in px/sec (balance → `$cfg`)
 */
export const thrustLift: BehaviorFn = (entity, world, params, dt) => {
  const keys = strArray(params, "thrustKeys");
  const lifting = world.input.anyDown(keys.length ? keys : ["Space"]);

  entity.vy += (lifting ? -num(params, "thrust", 0) : num(params, "gravity", 0)) * dt;

  const maxUp = num(params, "maxUp", 0);
  const maxDown = num(params, "maxDown", 0);
  if (entity.vy < -maxUp) entity.vy = -maxUp;
  if (entity.vy > maxDown) entity.vy = maxDown;
};

/**
 * 0.2.1 cleanup (LIBRARY-GAPS #8): the custom `scroll-ramp` behavior that used to
 * live here is GONE. The library now ships `scale-by-state` (behaviors/scale-by-state),
 * whose `target:"velocity", mode:"set", baseX/baseY, levelKey, perLevel` shape is the
 * exact ramp this game hand-rolled — so the obstacle prototype in play.json composes
 * the library part directly (`entity.vx = baseX * (1 + perLevel*(level-1))`, same math,
 * same `level-progression` counter). One fewer game-owned behavior; balance still 100%
 * in config. `thrust-lift` stays — no library part covers one-axis hold-thrust (#3).
 */

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerBehavior("thrust-lift", thrustLift);
}
