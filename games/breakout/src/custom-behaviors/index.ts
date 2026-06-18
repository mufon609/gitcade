import type { Registry } from "@gitcade/sdk";

/**
 * Breakout ships no custom parts — it composes only SDK built-ins + @gitcade/library.
 * The hook stays as the registration seam a vendored community-part remix installs into.
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors — pure SDK + library composition.
}
