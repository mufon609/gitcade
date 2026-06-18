import type { Registry } from "@gitcade/sdk";

/**
 * Survival Arena ships no custom parts — it composes only SDK built-ins + @gitcade/library
 * (the level-driven toughness/speed ramp is two data `scale-by-state` instances on the
 * enemy prototype). The hook stays as the registration seam a vendored community-part
 * remix installs into.
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors — pure SDK + library composition (scaling via scale-by-state).
}
