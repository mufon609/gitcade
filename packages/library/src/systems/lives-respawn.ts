import type { SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
import { GAME_OVER, RESPAWN } from "../channels.js";
import { vec2, spawnFrom, systemState } from "../util.js";

interface LivesState extends Record<string, unknown> {
  respawnTimer: number;
  awaitingRespawn: boolean;
  gameOver: boolean;
}

/**
 * Lives + respawn loop. Seeds `world.state[livesKey]` from `startLives`, watches
 * for the player entity (tag `watchTag`) being destroyed, and on its death spends
 * a life and respawns a fresh clone of `prototype` at `respawnPosition` after
 * `respawnDelay`. When lives run out it ends the game (lose). The arcade
 * three-lives loop, kept generic via the same prototype-spawn model as
 * `wave-spawner`.
 *
 * Params:
 *  - `startLives`: starting life count (balance → `$cfg`)
 *  - `prototype`: entity-definition respawned on death (required)
 *  - `livesKey`: `world.state` key holding remaining lives (default `"lives"`)
 *  - `watchTag`: tag of the entity whose death costs a life (default `"player"`)
 *  - `respawnPosition`: `{ x, y }` respawn point (structural; default prototype position)
 *  - `respawnDelay`: seconds before respawning (balance → `$cfg`; default 0)
 *  - `stateKey`: `world.state` scratch key for this system (default `"__livesRespawn"`)
 */
export const livesRespawn: SystemFn = (world, params, dt) => {
  const livesKey = str(params, "livesKey", "lives");
  const watchTag = str(params, "watchTag", "player");
  const respawnDelay = num(params, "respawnDelay", 0);
  const stateKey = str(params, "stateKey", "__livesRespawn");

  if (typeof world.state[livesKey] !== "number") {
    world.state[livesKey] = num(params, "startLives", 0);
  }

  const s = systemState<LivesState>(world, stateKey, {
    respawnTimer: 0,
    awaitingRespawn: false,
    gameOver: false,
  });
  if (s.gameOver) return;

  // Respawn countdown in progress.
  if (s.awaitingRespawn) {
    s.respawnTimer -= dt;
    if (s.respawnTimer <= 0) {
      s.awaitingRespawn = false;
      const hasPos = !!params.respawnPosition;
      spawnFrom(world, params.prototype, {
        idPrefix: watchTag,
        position: hasPos ? vec2(params, "respawnPosition") : undefined,
      });
      RESPAWN.emit(world, { livesLeft: world.state[livesKey] as number });
    }
    return;
  }

  // Player present → nothing to do.
  if (world.query(watchTag).length > 0) return;

  // Player gone: spend a life, or end the game.
  const lives = (world.state[livesKey] as number) - 1;
  world.state[livesKey] = lives;
  if (lives > 0) {
    s.awaitingRespawn = true;
    s.respawnTimer = respawnDelay;
  } else {
    s.gameOver = true;
    if (!world.state.gameOver) {
      world.state.gameOver = true;
      world.state.outcome = "lose";
      world.state.winner = "none";
      world.audio.play("lose");
      GAME_OVER.emit(world, { outcome: "lose" });
    }
  }
};
