import type { Registry } from "@gitcade/sdk";

/**
 * Pong needs ZERO custom behaviors — it is composed entirely from SDK primitives
 * (keyboard-axis, velocity, clamp-to-world, follow-entity-axis, bounce-world-edges,
 * reflect-on-hit, score-zone) and the aabb-collision + win-condition systems. If
 * Pong needed code here, the primitives would be too weak and the SDK would be the
 * thing to fix — not the game.
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // intentionally empty
}
