import type { Registry, BehaviorFn } from "@gitcade/sdk";
import { num, str, strArray } from "@gitcade/sdk";

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
 * `scroll-ramp` — auto-scroll whose speed RAMPS with a difficulty level read live
 * from `world.state`. The library `auto-scroll` part forces a static `$cfg` vx
 * every tick (it cannot read a counter), and `wave-spawner`/`level-progression`
 * read their `$cfg` params once at scene load — so there is no library path to make
 * the world scroll FASTER as a single play scene's difficulty climbs. This closes
 * exactly that gap: it sets `entity.vx = vx * (1 + (level-1) * perLevel)`, reading
 * the `levelKey` counter the library `level-progression` (scoreGte) maintains, so
 * the ramp stays data-driven (thresholds + per-level step all in `$cfg`) with one
 * tiny behavior instead of discrete per-level scenes.
 *
 * Like `auto-scroll`, order a `velocity` behavior AFTER it to integrate.
 * Logged in games/LIBRARY-GAPS.md as a generalization candidate
 * ("state-driven / ramping auto-scroll").
 *
 * Params:
 *  - `vx`/`vy`: base scroll velocity in px/sec at level 1 (balance → `$cfg`)
 *  - `levelKey`: `world.state` key holding the 1-based difficulty level (default `"level"`)
 *  - `perLevel`: fractional speed increase per level above 1 (balance → `$cfg`)
 */
export const scrollRamp: BehaviorFn = (entity, world, params) => {
  const vx = num(params, "vx", 0);
  const vy = num(params, "vy", 0);
  const levelKey = str(params, "levelKey", "level");
  const level = typeof world.state[levelKey] === "number" ? (world.state[levelKey] as number) : 1;
  const perLevel = num(params, "perLevel", 0);
  const mult = 1 + Math.max(0, level - 1) * perLevel;
  entity.vx = vx * mult;
  entity.vy = vy * mult;
};

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerBehavior("thrust-lift", thrustLift);
  registry.registerBehavior("scroll-ramp", scrollRamp);
}
