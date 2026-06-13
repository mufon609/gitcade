import type { Registry } from "@gitcade/sdk";

/**
 * Register any game-specific behaviors/systems here. Most games need NONE — they
 * compose SDK + library parts entirely from JSON. Only reach for a custom
 * behavior when no existing part fits, keep it param-driven (balance via `$cfg`),
 * and flag it as a candidate for generalization into the library.
 *
 * Example:
 *   import type { BehaviorFn } from "@gitcade/sdk";
 *   const wobble: BehaviorFn = (entity, _world, params, dt) => {
 *     entity.x += Math.sin(entity.state.t = ((entity.state.t as number) ?? 0) + dt) * (params.amount as number);
 *   };
 *   registry.registerBehavior("wobble", wobble);
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors in the scaffold — it is pure SDK + JSON.
}
