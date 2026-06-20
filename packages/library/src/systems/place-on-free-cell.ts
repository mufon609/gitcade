import type { SystemFn } from "@gitcade/sdk";
import { num, str, strArray } from "@gitcade/sdk";
import { randomFreeCell, spawnFrom } from "../util.js";

/**
 * `place-on-free-cell` — an event-driven SYSTEM that, whenever its `trigger` event
 * fires, spawns a clone of `prototype` at a verified-FREE grid cell (centered on
 * the cell), via {@link randomFreeCell} + `world.rng` for deterministic replay.
 * The data-over-code replacement for Snake's ~60-line hand-rolled free-cell food:
 * emit `eat` → the next food drops on a guaranteed-free, in-bounds cell (the
 * "first food on the wall" / overlap symptoms are impossible by construction).
 *
 * The trigger listener attaches exactly ONCE per scene, guarded by this instance's
 * `scratch` (the host hands back the same object each tick): a scene-scoped
 * {@link onScene} subscription, torn down on transition and re-attached on re-entry —
 * the per-instance replacement for the old module-level attach-once `WeakMap`.
 *
 * Params:
 *  - `prototype`: entity-definition to spawn (required)
 *  - `trigger`: event that triggers a placement (default `"place"`)
 *  - `tileSize`: grid cell size in px (structural)
 *  - `occupiedTag`: tag whose live entities mark a cell occupied (default = prototype's first tag)
 *  - `require`: optional tilemap gate, `"walkable"` | `"buildable"`
 *  - `excludeTags`: extra tags whose live entities also block their cell —
 *    tag a marker at a "soon-to-be-occupied" cell (e.g. Snake's imminent head cell)
 *    to keep a placement off it.
 */
export const placeOnFreeCell: SystemFn = (world, params, _dt, scratch = {}) => {
  if (scratch.attached) return;
  scratch.attached = true;
  const trigger = str(params, "trigger", "place");
  const tileSize = num(params, "tileSize", 0);
  const proto = params.prototype as { tags?: string[]; size?: { w?: number; h?: number } } | undefined;
  const occupiedTag = str(params, "occupiedTag", "") || proto?.tags?.[0] || "";
  const require = str(params, "require", "");
  const excludeTags = params.excludeTags !== undefined ? strArray(params, "excludeTags") : [];

  world.events.onScene(trigger, () => {
    if (tileSize <= 0) return;
    const cell = randomFreeCell(world, {
      tileSize,
      occupiedTag,
      require: require === "walkable" || require === "buildable" ? require : undefined,
      excludeTags,
    });
    if (!cell) return; // grid full
    const w = proto?.size?.w ?? 16;
    const h = proto?.size?.h ?? 16;
    spawnFrom(world, params.prototype, { position: { x: cell.x - w / 2, y: cell.y - h / 2 } });
  });
};
