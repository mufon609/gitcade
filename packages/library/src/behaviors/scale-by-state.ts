import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `scale-by-state` — ramp a live entity field by a factor derived from a 1-based
 * difficulty LEVEL counter in `world.state`. The library's `auto-scroll`/`ai-chase`
 * force a STATIC `$cfg` value and `wave-spawner` bakes a prototype's `$cfg` once at
 * scene load, so this is the only data path that makes one play scene scroll faster
 * — or its enemies tougher — as a live `level` climbs (e.g. a scroll-speed ramp, or
 * an enemy speed/hp ramp).
 *
 * The factor is `1 + perLevel * max(0, level - 1)` — i.e. `+perLevel` of the base
 * per level above 1. It is applied to `target` in one of three modes:
 *  - `"set"` (default): force the field to `base * factor` EVERY tick — for a
 *    value another part doesn't own this frame, e.g. an auto-scroll velocity
 *    (Helicopter `scroll-ramp`). The base comes from `base` (single axis /
 *    state) or `baseX`/`baseY` (velocity), NOT the live field (so it never
 *    compounds across ticks).
 *  - `"multiply"`: multiply the field's CURRENT value by `factor` every tick — to
 *    rescale a velocity another behavior just set this frame (Survival `swarm-scale`
 *    speed ramp). ORDERING (footgun): for a velocity target this must run AFTER the
 *    behavior that SETS the velocity (e.g. `ai-chase`) but BEFORE the `velocity`
 *    integrator — `ai-chase → scale-by-state(multiply) → velocity`. If it lands AFTER
 *    `velocity`, the integrator has already consumed the un-scaled velocity and the
 *    next tick's `ai-chase` overwrites the scaled value, so the ramp becomes a
 *    visual-only no-op (it changes the post-tick `vx/vy` a test reads but never the
 *    motion). `gitcade validate` warns (`scale-ramp-after-integrator`) on this.
 *  - `"once"`: set the field to `base * factor` exactly ONCE per entity (guarded by
 *    a per-entity flag), for a spawn-time stat like hp; `base` defaults to the
 *    field's current value, so it bumps a stat another part (e.g. `health-and-death`)
 *    seeded first. Order this AFTER that seeding behavior.
 *
 * `target` selects the field: `"vx"`, `"vy"`, `"velocity"` (both axes), or
 * `"state:<key>"` for an entity-state value (e.g. `"state:hp"`).
 *
 * Determinism + frozen tick order preserved: a pure per-tick read of `world.state`
 * + a field write, run in normal behavior order; no RNG, no events, no per-frame
 * work outside the tick.
 *
 * Params (all balance values → `$cfg`):
 *  - `levelKey`: `world.state` key holding the 1-based level (default `"level"`)
 *  - `perLevel`: fractional increase of the base per level above 1 (default 0)
 *  - `target`: `"vx"|"vy"|"velocity"|"state:<key>"` (default `"velocity"`)
 *  - `mode`: `"set"|"multiply"|"once"` (default `"set"`)
 *  - `base`: level-1 value for `"set"`/`"once"` on a single axis or a state key
 *  - `baseX`/`baseY`: level-1 velocity components for `"set"` with `target:"velocity"`
 */
export const scaleByState: BehaviorFn = (entity, world, params) => {
  const levelKey = str(params, "levelKey", "level");
  const level = typeof world.state[levelKey] === "number" ? (world.state[levelKey] as number) : 1;
  const perLevel = num(params, "perLevel", 0);
  const factor = 1 + perLevel * Math.max(0, level - 1);

  const target = str(params, "target", "velocity");
  const mode = str(params, "mode", "set");
  const stateKey = target.startsWith("state:") ? target.slice("state:".length) : null;

  if (mode === "multiply") {
    if (factor === 1) return; // no-op at level 1
    if (stateKey) {
      const cur = numState(entity, stateKey);
      entity.state[stateKey] = cur * factor;
    } else {
      if (target === "vx" || target === "velocity") entity.vx *= factor;
      if (target === "vy" || target === "velocity") entity.vy *= factor;
    }
    return;
  }

  if (mode === "once") {
    const flag = `__scaled:${target}`; // keyed by target so two instances don't collide
    if (entity.state[flag]) return;
    entity.state[flag] = true;
    if (stateKey) {
      const base = num(params, "base", numState(entity, stateKey));
      entity.state[stateKey] = base * factor;
    } else {
      if (target === "vx" || target === "velocity") entity.vx = num(params, "base", entity.vx) * factor;
      if (target === "vy" || target === "velocity") entity.vy = num(params, "base", entity.vy) * factor;
    }
    return;
  }

  // mode === "set" (default): force base * factor each tick (base from params).
  if (stateKey) {
    const base = num(params, "base", numState(entity, stateKey));
    entity.state[stateKey] = base * factor;
    return;
  }
  if (target === "velocity") {
    entity.vx = num(params, "baseX", 0) * factor;
    entity.vy = num(params, "baseY", 0) * factor;
    return;
  }
  if (target === "vx") entity.vx = num(params, "base", 0) * factor;
  if (target === "vy") entity.vy = num(params, "base", 0) * factor;
};

function numState(entity: { state: Record<string, unknown> }, key: string): number {
  return typeof entity.state[key] === "number" ? (entity.state[key] as number) : 0;
}
