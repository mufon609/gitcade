import type { Registry } from "@gitcade/sdk";

/**
 * Register any game-specific behaviors/systems here. Most games need NONE — they
 * compose SDK + library parts entirely from JSON. Only reach for a custom
 * behavior when no existing part fits, keep it param-driven (balance via `$cfg`),
 * and flag it as a candidate for generalization into the library.
 *
 * Example:
 *   import type { BehaviorFn } from "@gitcade/sdk";
 *   const wobble: BehaviorFn = (entity, world, params, dt) => {
 *     // Route simulation transcendentals through `world.math` (sin/cos/atan2/pow/hypot/…), NOT
 *     // raw `Math.sin`: it writes `entity.x`, which is part of the deterministic snapshot, and
 *     // `world.math` is engine-independent so the run replays byte-identically in any JS engine.
 *     // (Raw `Math.*` transcendentals differ in the last ULP across engines and desync ghosts /
 *     // speedrun verification — the validator flags them as an advisory.)
 *     const t = (entity.state.t = ((entity.state.t as number) ?? 0) + dt);
 *     entity.x += world.math.sin(t) * (params.amount as number);
 *   };
 *   registry.registerBehavior("wobble", wobble);
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors in the scaffold — it is pure SDK + JSON.
}
