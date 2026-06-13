import type { SystemFn } from "../types.js";

interface Condition {
  /** `world.state` key to test (e.g. `"scoreLeft"`). */
  key: string;
  /** Threshold that ends the game when reached (balance → `$cfg`). */
  gte: number;
  /** Value stored in `world.state.winner` when this condition fires. */
  winner: string;
}

/**
 * Generic win/lose check. When any condition's tracked `world.state[key]` reaches
 * its `gte` threshold, sets `world.state.gameOver = true` and `world.state.winner`,
 * plays a sound once, and emits a `"gameover"` event. Idempotent after the game
 * ends.
 *
 * Params:
 *  - `conditions`: array of `{ key, gte, winner }`
 *  - `sound`: sound key to play on game over (default `"win"`)
 */
export const winCondition: SystemFn = (world, params) => {
  if (world.state.gameOver) return;
  const conditions = (Array.isArray(params.conditions) ? params.conditions : []) as Condition[];
  const sound = typeof params.sound === "string" ? params.sound : "win";

  for (const c of conditions) {
    const v = (world.state[c.key] as number) ?? 0;
    if (typeof c.gte === "number" && v >= c.gte) {
      world.state.gameOver = true;
      world.state.winner = c.winner;
      world.audio.play(sound);
      world.events.emit("gameover", { winner: c.winner });
      return;
    }
  }
};
