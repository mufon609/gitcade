import type { Registry } from "@gitcade/sdk";

/**
 * Survival Arena needs NO custom parts — the player (move-topdown-360 + auto
 * `shoot` + health-and-death), the escalating swarm (`wave-spawner` of
 * ai-chase + contact-damage + health-and-death enemies), the survive-the-clock
 * win (`timer-countdown`), the loss (`win-lose-conditions`), the score, and the
 * `explosion` particles are all @gitcade/library + SDK parts. Kept for parity.
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors — pure SDK + library composition.
}
