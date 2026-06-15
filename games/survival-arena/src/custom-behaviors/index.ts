import type { Registry } from "@gitcade/sdk";

/**
 * Survival Arena custom parts — NONE remain as of the 0.2.1 repin.
 *
 * The game is pure SDK + @gitcade/library composition (player = `move-topdown-360`
 * + auto `shoot` + `health-and-death`; swarm = `wave-spawner` of `ai-chase` +
 * `contact-damage` + `health-and-death`; `timer-countdown` win, `win-lose-conditions`
 * loss, `score`, `persistence`, and the `explosion`/`sparkle` FX presets).
 *
 * The ONE mechanic that used to need a custom part — making the swarm tougher AND
 * faster as the difficulty `level` climbs (`swarm-scale`) — is now expressed as DATA
 * with the library `scale-by-state` behavior (0.2.1, LIBRARY-GAPS #8). The enemy
 * prototype in play.json runs TWO instances: a `mode:"multiply" target:"velocity"`
 * after `ai-chase`/`velocity` (per-tick speed ramp) and a `mode:"once"
 * target:"state:hp"` after `health-and-death` (one-time spawn-hp bump). Same math
 * (speed 95→188, hp 80→203 across levels 1→8), no game-owned behavior, balance still
 * 100% in config. This hook is kept for parity with the other games and the scaffold.
 */
export function registerCustomBehaviors(_registry: Registry): void {
  // No custom behaviors — pure SDK + library composition (scaling via scale-by-state).
}
