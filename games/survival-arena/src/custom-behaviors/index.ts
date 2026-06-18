import type { Registry } from "@gitcade/sdk";

/**
 * Survival Arena has NO custom parts — it's pure SDK + @gitcade/library composition
 * (player = `move-topdown-360` + auto `shoot` + `health-and-death`; swarm =
 * `wave-spawner` of `ai-chase` + `contact-damage` + `health-and-death`;
 * `timer-countdown` win, `win-lose-conditions` loss, `score`, `persistence`, and the
 * `explosion`/`sparkle` FX presets).
 *
 * Making the swarm tougher AND faster as the difficulty `level` climbs is expressed as
 * DATA with the library `scale-by-state` behavior. The enemy prototype in play.json
 * runs TWO instances: a `mode:"multiply" target:"velocity"` after `ai-chase`/`velocity`
 * (per-tick speed ramp) and a `mode:"once" target:"state:hp"` after `health-and-death`
 * (one-time spawn-hp bump). No game-owned behavior; balance stays 100% in config. This
 * hook is kept for parity with the other games and the scaffold.
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors — pure SDK + library composition (scaling via scale-by-state).
}
