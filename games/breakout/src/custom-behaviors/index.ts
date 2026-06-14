import type { Registry } from "@gitcade/sdk";

/**
 * Breakout needs NO custom parts — it is composed entirely from SDK built-ins
 * (`velocity`, `bounce-world-edges`, `reflect-on-hit`, `clamp-to-world`,
 * `aabb-collision`) and @gitcade/library parts (`move-4dir`, `contact-damage`,
 * `health-and-death`, `trigger-zone`, `lives-respawn`, `level-progression`,
 * `score`, `win-lose-conditions`). This hook is kept for parity with the other
 * games and the scaffold.
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors — pure SDK + library composition.
}
