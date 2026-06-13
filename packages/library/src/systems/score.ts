import type { SystemFn, World } from "@gitcade/sdk";
import { str } from "@gitcade/sdk";

/**
 * Track the score and persist a high score. Other parts increment
 * `world.state[scoreKey]` (e.g. `collect-on-touch`, `health-and-death` tallies);
 * this system keeps `world.state[highKey]` at the running maximum and persists it
 * across sessions via the SDK STORAGE API — never raw localStorage, so a fork or
 * a branch switch can't corrupt another build's saves (Locked Decision).
 *
 * Persistence is async and fire-and-forget: on the first tick it loads the stored
 * high score; whenever the high score improves it writes it back (debounced to
 * one write per improvement). Both calls go through `world.storage`, which is the
 * in-memory/file dev-shim locally and the postMessage bridge in production.
 *
 * Params:
 *  - `scoreKey`: live score key on `world.state` (default `"score"`)
 *  - `highKey`: high-score key on `world.state` (default `"highScore"`)
 *  - `storageKey`: persistence key under the game's storage namespace (default `"highScore"`)
 *  - `persist`: write the high score to storage (default true)
 */
export const score: SystemFn = (world, params) => {
  const scoreKey = str(params, "scoreKey", "score");
  const highKey = str(params, "highKey", "highScore");
  const storageKey = str(params, "storageKey", "highScore");
  const persist = params.persist !== false;

  // One-time async load of the persisted high score.
  if (!world.state.__scoreLoaded) {
    world.state.__scoreLoaded = true;
    if (persist) {
      void world.storage.get<number>(storageKey).then((stored) => {
        if (typeof stored === "number") {
          const cur = (world.state[highKey] as number) ?? 0;
          if (stored > cur) world.state[highKey] = stored;
        }
      });
    }
  }

  const current = (world.state[scoreKey] as number) ?? 0;
  const high = (world.state[highKey] as number) ?? 0;
  if (current > high) {
    world.state[highKey] = current;
    if (persist) saveHigh(world, storageKey, current);
  }
};

function saveHigh(world: World, storageKey: string, value: number): void {
  if ((world.state.__scoreSaved as number) === value) return;
  world.state.__scoreSaved = value;
  void world.storage.set(storageKey, value);
}
