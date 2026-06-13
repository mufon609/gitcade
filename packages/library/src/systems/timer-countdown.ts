import type { SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * A countdown clock. Seeds `world.state[timeKey]` to `duration` on the first tick,
 * subtracts real elapsed time each tick, clamps at zero, and on expiry emits an
 * event once and (optionally) ends the game with a win or a lose outcome — the
 * survive-the-clock or beat-the-clock primitive. Pauses while
 * `world.state[pauseKey]` is truthy.
 *
 * Params:
 *  - `duration`: starting time in seconds (balance → `$cfg`)
 *  - `timeKey`: `world.state` key holding the remaining time (default `"timeLeft"`)
 *  - `event`: event emitted at zero (default `"time-up"`)
 *  - `onExpire`: `"lose"` | `"win"` | `"none"` — game outcome at zero (default `"lose"`)
 *  - `pauseKey`: `world.state` key that pauses the timer while truthy (default `"paused"`)
 */
export const timerCountdown: SystemFn = (world, params, dt) => {
  const timeKey = str(params, "timeKey", "timeLeft");
  const pauseKey = str(params, "pauseKey", "paused");

  if (typeof world.state[timeKey] !== "number") {
    world.state[timeKey] = num(params, "duration", 0);
  }
  if (world.state.__timerExpired || world.state[pauseKey]) return;

  let t = (world.state[timeKey] as number) - dt;
  if (t <= 0) {
    t = 0;
    world.state.__timerExpired = true;
    world.events.emit(str(params, "event", "time-up"), {});
    const onExpire = str(params, "onExpire", "lose");
    if (onExpire !== "none" && !world.state.gameOver) {
      world.state.gameOver = true;
      world.state.outcome = onExpire;
      world.state.winner = onExpire === "win" ? "player" : "time";
      world.audio.play(onExpire === "win" ? "win" : "lose");
      world.events.emit("gameover", { outcome: onExpire });
    }
  }
  world.state[timeKey] = t;
};
