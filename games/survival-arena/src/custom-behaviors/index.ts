import type { Registry, BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * Survival Arena custom parts.
 *
 * The whole game is otherwise pure SDK + @gitcade/library composition (the player =
 * `move-topdown-360` + auto `shoot` + `health-and-death`; the swarm = `wave-spawner`
 * of `ai-chase` + `contact-damage` + `health-and-death` enemies; `timer-countdown`
 * win, `win-lose-conditions` loss, `score`, `persistence`, and the `explosion` /
 * `sparkle` FX presets). The ONE mechanic 0.2.0 cannot express as data is making the
 * swarm *tougher and faster* as the difficulty level climbs:
 *
 *   `wave-spawner` resolves its `prototype` `$cfg` refs ONCE at scene load, and
 *   `ai-chase` / `health-and-death` read their `speed` / `hp` from those baked-in
 *   params — so there is no data path to scale a LIVE `world.state.level` into enemy
 *   speed or hp. `waveSizeGrowth` scales the COUNT as data, but not the toughness.
 *
 * `swarm-scale` closes exactly that — the same shape as Helicopter's `scroll-ramp`
 * (LIBRARY-GAPS #8): a tiny per-enemy behavior that reads the `levelKey` counter the
 * library `level-progression` maintains and (a) bumps the enemy's starting hp once,
 * at spawn, by `hpPerLevel`, and (b) rescales the post-`ai-chase` velocity by
 * `speedPerLevel`. ALL balance stays in `$cfg`; no game logic leaves config.
 */

/**
 * `swarm-scale` — per-enemy difficulty ramp by the live `level` counter.
 *
 * Order it AFTER `ai-chase` + `velocity`-set so it rescales the chosen pursuit
 * velocity (multiplying the vector preserves the chase direction), and let
 * `health-and-death` (also before it) seed `state.hp` first — this behavior bumps
 * that seeded hp exactly once (guarded by `__scaled`) so an enemy spawns tankier at
 * higher levels and faster at every tick.
 *
 * Params (all balance → `$cfg`):
 *  - `levelKey`: `world.state` key holding the 1-based difficulty level (default `"level"`)
 *  - `speedPerLevel`: fractional pursuit-speed added per level above 1
 *  - `hpPerLevel`: fractional starting-hp added per level above 1
 *  - `baseHp`: the prototype's nominal hp, used to size the one-time bump
 */
export const swarmScale: BehaviorFn = (entity, world, params) => {
  const levelKey = str(params, "levelKey", "level");
  const level = typeof world.state[levelKey] === "number" ? (world.state[levelKey] as number) : 1;
  const factor = Math.max(1, level);

  // (a) one-time hp bump at spawn, after health-and-death has seeded state.hp.
  if (!entity.state.__scaled && typeof entity.state.hp === "number") {
    const hpPerLevel = num(params, "hpPerLevel", 0);
    const baseHp = num(params, "baseHp", entity.state.hp as number);
    entity.state.hp = baseHp * (1 + hpPerLevel * (factor - 1));
    entity.state.__scaled = true;
  }

  // (b) speed ramp: rescale the post-chase velocity vector (keeps the direction).
  const speedPerLevel = num(params, "speedPerLevel", 0);
  if (speedPerLevel > 0 && factor > 1) {
    const mult = 1 + speedPerLevel * (factor - 1);
    entity.vx *= mult;
    entity.vy *= mult;
  }
};

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerBehavior("swarm-scale", swarmScale);
}
