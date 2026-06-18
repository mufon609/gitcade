import type { SystemFn, World } from "@gitcade/sdk";

/**
 * `stat-modifier` — apply a `world.state`-driven value to a named behavior PARAM
 * across EVERY entity carrying a tag (0.4.0, ENGINE-ROADMAP #E6). It is the
 * SHARED/global counterpart to the entity-self `scale-by-state`: where that ramps
 * one entity from its OWN state, this propagates a value held in `world.state`
 * (raised by an `upgrade-tree`, a `prestige` multiplier, a difficulty `level`, …)
 * out to a behavior param on MANY entities at once.
 *
 * Before this, the only data path was per-entity. A shared upgrade therefore got
 * hand-rolled in host JS: tower-defense reached into every live tower's
 * `behaviors[].params.range`/`cooldown` on each `upgrade-purchased` event AND
 * re-stamped each freshly-spawned tower (`restampTowers`/`stampDef`). This system
 * is that pattern generalized — pure data, no custom code.
 *
 * Per `modifier` it computes one value and writes it to `param` on every matching
 * behavior of every `world.query(tag)` entity, EVERY tick. Because systems run
 * before behaviors in the frozen tick order, the write is seen by the behavior the
 * same tick — and a per-tick set is self-healing: an entity spawned this tick is
 * stamped this tick, and a `world.state` change (an upgrade bought) propagates with
 * no event wiring. (Determinism preserved: a pure read of `world.state` + a param
 * write, in normal system order; no RNG, no events.)
 *
 * The value is computed exactly like `scale-by-state`, just sourced shared instead
 * of self:
 *   base  = `world.state[from]` (the live, already-upgraded absolute value) — or,
 *           when `from` is unset/non-numeric, the `base` fallback ($cfg).
 *   ×     = the difficulty factor `1 + perLevel·max(0, level−1)` when `levelKey`/
 *           `perLevel` is given (the scale-by-state ramp math).
 *   ×     = `world.state[multKey]` when given (the prestige-style global multiplier).
 *   clamp = `[min, max]` when given (e.g. a tower's `towerMinCooldown` floor).
 * If nothing resolves to a number the modifier is skipped (no NaN written).
 *
 * Params (all balance values → `$cfg`; structural keys are plain strings):
 *  - `modifiers`: array of:
 *     - `tag`: entities carrying this tag are modified (required, structural)
 *     - `param`: the behavior param key to write (required, structural)
 *     - `behavior`: only behaviors of this `type` (optional; default: all of the
 *        entity's behaviors)
 *     - `from`: `world.state` key holding the value to apply (structural)
 *     - `base`: a `$cfg` base, used when `from` is absent or its state is unset
 *     - `levelKey`: `world.state` key holding a 1-based level (default `"level"`)
 *     - `perLevel`: fractional increase of the base per level above 1 ($cfg)
 *     - `multKey`: `world.state` key multiplied into the result
 *     - `min` / `max`: clamp bounds ($cfg)
 */
interface Modifier {
  tag?: unknown;
  param?: unknown;
  behavior?: unknown;
  from?: unknown;
  base?: unknown;
  levelKey?: unknown;
  perLevel?: unknown;
  multKey?: unknown;
  min?: unknown;
  max?: unknown;
}

export const statModifier: SystemFn = (world, params) => {
  const modifiers = Array.isArray(params.modifiers) ? (params.modifiers as Modifier[]) : [];
  for (const m of modifiers) {
    if (!m || typeof m.tag !== "string" || typeof m.param !== "string") continue;
    const value = computeValue(world, m);
    if (value === undefined) continue;
    const behaviorFilter = typeof m.behavior === "string" ? m.behavior : null;
    for (const e of world.query(m.tag)) {
      for (const b of e.behaviors) {
        if (behaviorFilter && b.type !== behaviorFilter) continue;
        (b.params as Record<string, unknown>)[m.param] = value;
      }
    }
  }
};

/** Resolve a modifier to a single number (or `undefined` to skip writing it). */
function computeValue(world: World, m: Modifier): number | undefined {
  // Base: the live world.state value (`from`) — the absolute, already-upgraded
  // number another part (upgrade-tree/currency) owns — falling back to a $cfg `base`.
  let v: number;
  if (typeof m.from === "string" && typeof world.state[m.from] === "number") {
    v = world.state[m.from] as number;
  } else if (typeof m.base === "number") {
    v = m.base;
  } else {
    return undefined; // nothing numeric to apply (e.g. an unseeded key, no base)
  }

  // scale-by-state difficulty factor (shared): 1 + perLevel*(level-1).
  if (typeof m.levelKey === "string" || typeof m.perLevel === "number") {
    const levelKey = typeof m.levelKey === "string" ? m.levelKey : "level";
    const level = typeof world.state[levelKey] === "number" ? (world.state[levelKey] as number) : 1;
    const perLevel = typeof m.perLevel === "number" ? m.perLevel : 0;
    v *= 1 + perLevel * Math.max(0, level - 1);
  }

  // Global multiplier (the prestige-style shared mult): × world.state[multKey].
  if (typeof m.multKey === "string") {
    const mult = world.state[m.multKey];
    v *= typeof mult === "number" ? mult : 1;
  }

  if (typeof m.min === "number") v = Math.max(m.min, v);
  if (typeof m.max === "number") v = Math.min(m.max, v);
  return v;
}
