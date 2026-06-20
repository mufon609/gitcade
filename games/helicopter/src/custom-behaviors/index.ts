import type { Registry, BehaviorFn } from "@gitcade/sdk";
import { num, str, strArray } from "@gitcade/sdk";

/**
 * `thrust-lift` — the one mechanic a one-button flyer needs that no
 * @gitcade/library part provides: hold the THRUST action to accelerate UP against a
 * constant gravity, release to fall. Clamps the vertical speed both ways. Sets
 * `entity.vy` for a following SDK `velocity` integrator; horizontal position is
 * fixed (the world scrolls past).
 *
 * Written param-driven — all balance via `$cfg`, no magic numbers. A one-axis
 * thrust / flappy-style control, the kind of mechanic auto-scrollers and jetpack
 * games all want.
 *
 * The lift intent is read through the logical `thrustAction` when set — so keyboard
 * AND a hold-anywhere touch zone (both declared by the `input-actions` system in
 * play.json) feed ONE channel. `thrustKeys` is the fallback when no `thrustAction`
 * is given.
 *
 * Params:
 *  - `thrustAction`: logical action name to read; unset ⇒ read `thrustKeys`
 *  - `thrustKeys`: key codes that lift (default `["Space"]`); used only when no `thrustAction`
 *  - `thrust`: upward acceleration in px/sec² (balance → `$cfg`)
 *  - `gravity`: downward acceleration in px/sec² (balance → `$cfg`)
 *  - `maxUp` / `maxDown`: vertical speed clamps in px/sec (balance → `$cfg`)
 */
export const thrustLift: BehaviorFn = (entity, world, params, dt) => {
  const action = str(params, "thrustAction", "");
  const keys = strArray(params, "thrustKeys");
  const lifting = action ? world.input.action(action) : world.input.anyDown(keys.length ? keys : ["Space"]);

  entity.vy += (lifting ? -num(params, "thrust", 0) : num(params, "gravity", 0)) * dt;

  const maxUp = num(params, "maxUp", 0);
  const maxDown = num(params, "maxDown", 0);
  if (entity.vy < -maxUp) entity.vy = -maxUp;
  if (entity.vy > maxDown) entity.vy = maxDown;
};

/**
 * The difficulty ramp is the library's `scale-by-state` part (behaviors/scale-by-state),
 * whose `target:"velocity", mode:"set", baseX/baseY, levelKey, perLevel` shape the
 * obstacle prototype in play.json composes directly (`entity.vx = baseX *
 * (1 + perLevel*(level-1))`, driven by the `level-progression` counter). `thrust-lift`
 * is the only game-owned behavior — no library part covers one-axis hold-thrust.
 */

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerBehavior("thrust-lift", thrustLift);
}
