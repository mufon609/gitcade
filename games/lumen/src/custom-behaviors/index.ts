import type { Registry } from "@gitcade/sdk";

/**
 * Lumen ships NO custom parts — it composes only SDK built-ins + @gitcade/library
 * (movement, collision, AI, FX, HUD all come from catalogued parts). The hook stays
 * as the registration seam a vendored community-part remix installs into, and so the
 * smoke test (which the validator defers to) registers a fork's vendored behavior
 * instead of throwing "unknown behavior type" during ecosystem validation.
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors — pure SDK + library composition.
}
