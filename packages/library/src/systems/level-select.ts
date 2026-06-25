import type { SystemFn } from "@gitcade/sdk";
import { str, strArray } from "@gitcade/sdk";

/** A level's best scalars, as the run-store writes them into the progress index (loaded by `persistence`). */
interface LevelBestLike {
  score?: number;
  seconds?: number | null;
}

/**
 * `level-select` — the projection that makes a DATA-authored level-select menu work. It is the scene-side
 * companion to the library `createRunStore` (the between-runs writer) + the SDK `@level:<id>` flow token
 * (the router): the run-store persists a per-game progress INDEX — a won-set map + a per-level bests map —
 * which the `persistence` system loads into `world.state` (the `runWon` / `runBest` keys), and THIS system
 * fans that nested index out into the FLAT, per-level keys a menu scene actually consumes:
 *  - `<id>:sel`    — boolean "is this level selectable" (it has been CLEARED). A gated `tap-emit`
 *                    (`requireKey: "<id>:sel"`) reads it, so only won levels are pickable — won-gating as
 *                    pure DATA, no custom behavior and no host bandaid.
 *  - `<id>:status` — the `clearedText` / `lockedText` label (a text sprite `bind`s to it).
 *  - `<id>:score`  — the best SCORE, via `scoreTemplate` (`{v}` = the number) — only when cleared.
 *  - `<id>:time`   — the best TIME in seconds (1 dp), via `timeTemplate` — only when cleared.
 *
 * Why a projection and not a direct `bind`: the run-store index is NESTED (`runBest["level-1"].seconds`),
 * and a text sprite's `bind` / `format-binding` read a FLAT `world.state` key. This drills the per-level
 * slice out once per tick so the rest of the menu is plain binds + a gated tap. It is pure (reads
 * `world.state` maps, writes `world.state` strings/booleans — no rng, no clock, no transcendentals), so it
 * never perturbs determinism, and idle/safe headless (an empty index ⇒ every level locked). Runs as a
 * SYSTEM (before the behavior phase) so the `sel` flag is current when `tap-emit` reads it the same tick.
 *
 * Params:
 *  - `levels`: ordered level (scene) ids to project — typically the game's `manifest.levels`.
 *  - `wonKey` / `bestKey`: the index map keys (default `"runWon"` / `"runBest"` — the run-store defaults).
 *  - `prefix`: namespacing prefix for the written keys (default `""` ⇒ `"<id>:sel"` etc.).
 *  - `clearedText` / `lockedText`: the status labels (default `"CLEARED"` / `"LOCKED"`).
 *  - `scoreTemplate` / `timeTemplate`: `{v}`-templates for the stats (default `"{v}"` / `"{v}s"`).
 *  All params are strings / string-arrays — no numeric balance, so the block is magic-number-clean.
 */
export const levelSelect: SystemFn = (world, params) => {
  const levels = strArray(params, "levels");
  if (levels.length === 0) return;
  const wonKey = str(params, "wonKey", "runWon");
  const bestKey = str(params, "bestKey", "runBest");
  const prefix = str(params, "prefix", "");
  const clearedText = str(params, "clearedText", "CLEARED");
  const lockedText = str(params, "lockedText", "LOCKED");
  const scoreTemplate = str(params, "scoreTemplate", "{v}");
  const timeTemplate = str(params, "timeTemplate", "{v}s");

  const wonMap = asMap(world.state[wonKey]);
  const bestMap = asMap(world.state[bestKey]);

  for (const id of levels) {
    const won = wonMap[id] === true;
    const best = (bestMap[id] ?? undefined) as LevelBestLike | undefined;
    world.state[`${prefix}${id}:sel`] = won; // the gate a `tap-emit` requireKey reads
    world.state[`${prefix}${id}:status`] = won ? clearedText : lockedText;
    // Stats show for CLEARED levels (the selectable ones); a locked card stays clean.
    world.state[`${prefix}${id}:score`] = won ? scoreTemplate.replace("{v}", String(best?.score ?? 0)) : "";
    const seconds = best?.seconds;
    world.state[`${prefix}${id}:time`] =
      won && typeof seconds === "number" ? timeTemplate.replace("{v}", seconds.toFixed(1)) : "";
  }
};

/** Read a `world.state` value as a string-keyed map (the run-store index shape), or `{}` if absent/not an object. */
function asMap(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
