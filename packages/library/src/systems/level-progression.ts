import type { SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
import { systemState } from "../util.js";

interface LevelState extends Record<string, unknown> {
  level: number;
  sawTag: boolean;
}

/**
 * Advance a difficulty/level counter when a condition is met, emitting a
 * `"level-up"` event each time so spawners and HUDs can react. Two trigger modes:
 * a score threshold that ratchets up each level, or "the tracked tag has been
 * fully cleared" (all enemies dead → next level). It does NOT swap scenes — the
 * SDK's scene loading is a host concern — it manages the `levelKey` counter that
 * other parts read.
 *
 * Params:
 *  - `levelKey`: `world.state` key holding the current level, 1-based (default `"level"`)
 *  - `mode`: `"scoreGte"` | `"clearTag"` (default `"clearTag"`)
 *  - `scoreKey`: score key to read in `scoreGte` mode (default `"score"`)
 *  - `threshold`: score for the first level-up in `scoreGte` mode (balance → `$cfg`)
 *  - `thresholdGrowth`: added to `threshold` per level (balance → `$cfg`; default 0)
 *  - `clearTag`: tag whose disappearance triggers a level-up in `clearTag` mode (default `"enemy"`)
 *  - `maxLevel`: stop advancing past this level, 0 = endless (balance → `$cfg`; default 0)
 *  - `event`: event emitted on each advance (default `"level-up"`)
 *  - `stateKey`: `world.state` scratch key (default `"__levelProgression"`)
 */
export const levelProgression: SystemFn = (world, params) => {
  const levelKey = str(params, "levelKey", "level");
  const mode = str(params, "mode", "clearTag");
  const maxLevel = num(params, "maxLevel", 0);
  const event = str(params, "event", "level-up");
  const stateKey = str(params, "stateKey", "__levelProgression");

  const s = systemState<LevelState>(world, stateKey, { level: 1, sawTag: false });
  if (typeof world.state[levelKey] !== "number") world.state[levelKey] = s.level;
  if (maxLevel > 0 && s.level >= maxLevel) return;

  let advance = false;
  if (mode === "scoreGte") {
    const scoreKey = str(params, "scoreKey", "score");
    const base = num(params, "threshold", 0);
    const grow = num(params, "thresholdGrowth", 0);
    const need = base + grow * (s.level - 1);
    advance = ((world.state[scoreKey] as number) ?? 0) >= need && need > 0;
  } else {
    const clearTag = str(params, "clearTag", "enemy");
    const count = world.query(clearTag).length;
    if (count > 0) s.sawTag = true;
    advance = s.sawTag && count === 0;
    if (advance) s.sawTag = false;
  }

  if (advance) {
    s.level += 1;
    world.state[levelKey] = s.level;
    world.events.emit(event, { level: s.level });
  }
};
