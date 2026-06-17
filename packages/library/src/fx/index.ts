import type { Registry } from "@gitcade/sdk";
import { particle } from "./particle.js";
import { explosion, sparkle, trail, dust } from "./emitters.js";

/**
 * FX half of Phase 2B. Two kinds of part:
 *  - PARTICLE presets (`explosion`, `sparkle`, `trail`, `dust`) are real runtime
 *    types catalogued under kind `fx`. `explosion`/`sparkle` are event-driven
 *    SYSTEMS; `trail`/`dust` are per-entity BEHAVIORS. They spawn short-lived
 *    particle entities, so the internal `particle` behavior is registered too.
 *  - SCREEN effects (`screen-shake`/`screen-flash`/`screen-fade`) are host-side and
 *    live in {@link ScreenEffects}; they register no runtime type (see that file).
 *
 * These register on a SEPARATE map from the 2A logic library so the catalog's
 * behavior/system-kind coverage check stays exact — FX register runtime types but
 * are catalogued as kind `fx`, never as `behavior`/`system`.
 */
export const LIBRARY_FX_BEHAVIORS = {
  trail,
  dust,
  // `particle` is internal infra (no catalog part) but must be registered so
  // spawned particles resolve their behavior.
  particle,
} as const;

export const LIBRARY_FX_SYSTEMS = {
  explosion,
  sparkle,
} as const;

/** FX part ids that are runtime types (excludes the internal `particle`). */
export const LIBRARY_FX_PARTICLE_TYPES = ["explosion", "sparkle", "trail", "dust"] as const;

export function registerLibraryFx(registry: Registry): void {
  for (const [type, fn] of Object.entries(LIBRARY_FX_BEHAVIORS)) registry.registerBehavior(type, fn);
  for (const [type, fn] of Object.entries(LIBRARY_FX_SYSTEMS)) registry.registerSystem(type, fn);
}

export { particle, spawnBurst, eventPos, type BurstOptions } from "./particle.js";
export { explosion, sparkle, trail, dust } from "./emitters.js";
export { ScreenEffects, attachScreenEffects, throttle, type ScreenEffectFrame } from "./screen-effects.js";
