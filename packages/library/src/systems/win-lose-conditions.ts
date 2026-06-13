import type { SystemFn } from "@gitcade/sdk";

interface Condition {
  /** `world.state` key to test. */
  key: string;
  /** Comparison against `value`: `"gte"` | `"lte"` | `"eq"`. */
  cmp?: "gte" | "lte" | "eq";
  /** Threshold value (balance → `$cfg`). */
  value: number;
  /** Outcome when this condition fires. */
  outcome?: "win" | "lose";
  /** Optional label stored in `world.state.winner`. */
  winner?: string;
  /** Optional sound key (defaults to win/lose). */
  sound?: string;
}

/**
 * Generalized end-of-game check. The SDK's built-in `win-condition` only fires a
 * WIN on a `>=` threshold; this evaluates a list of conditions with `gte`/`lte`/`eq`
 * comparisons and per-condition WIN or LOSE outcomes — so "score ≥ 10 wins" and
 * "playerDeaths ≥ 1 loses" and "creepsLeaked ≥ 20 loses" coexist. The first
 * matching condition ends the game: sets `gameOver`, `outcome`, and `winner`,
 * plays a sound, and emits `"gameover"`. Idempotent once the game is over.
 *
 * Conditions reference `world.state` keys maintained by other parts
 * (`health-and-death` tallies, `score`, `currency`, etc.), keeping all the
 * thresholds in `$cfg`.
 *
 * Params:
 *  - `conditions`: array of `{ key, cmp?, value, outcome?, winner?, sound? }`
 */
export const winLoseConditions: SystemFn = (world, params) => {
  if (world.state.gameOver) return;
  const conditions = (Array.isArray(params.conditions) ? params.conditions : []) as Condition[];

  for (const c of conditions) {
    if (!c || typeof c.key !== "string" || typeof c.value !== "number") continue;
    const v = (world.state[c.key] as number) ?? 0;
    const cmp = c.cmp ?? "gte";
    const hit = cmp === "lte" ? v <= c.value : cmp === "eq" ? v === c.value : v >= c.value;
    if (!hit) continue;

    const outcome = c.outcome ?? "win";
    world.state.gameOver = true;
    world.state.outcome = outcome;
    world.state.winner = c.winner ?? (outcome === "win" ? "player" : "none");
    world.audio.play(c.sound ?? (outcome === "win" ? "win" : "lose"));
    world.events.emit("gameover", { outcome, winner: world.state.winner, by: c.key });
    return;
  }
};
