import { z } from "zod";
import { EntityDefSchema, EntityOverrideSchema } from "./entity.js";
import { SystemDefSchema } from "./system.js";

/**
 * Per-tile-INDEX property flags. Open-ended: the three named
 * flags are conveniences; `catchall` keeps it usable for game-specific markers
 * (e.g. `{ "1": { lane: true, walkable: true, buildable: false } }`). Presentational/
 * structural data, so exempt from the magic-number rule like the rest of the tilemap.
 */
export const TilePropsSchema = z
  .object({
    buildable: z.boolean().optional(),
    walkable: z.boolean().optional(),
    lane: z.boolean().optional(),
    /** Solid terrain: the collision-resolution phase resolves a `collider` against any cell
     *  flagged this (the platformer floor/wall/ceiling). A named convenience over the catchall
     *  — purely additive. */
    solid: z.boolean().optional(),
    /** One-way (pass-through) platform: the resolution phase lands a FALLING body on a cell
     *  flagged this but lets the body jump up THROUGH it and (with the mover's drop-through)
     *  fall down through it — solid on its top face only. A named convenience over the
     *  catchall — purely additive. */
    oneWay: z.boolean().optional(),
    /** Floor-SLOPE surface heights: the walkable surface height in px UP FROM THE CELL BOTTOM
     *  at the cell's LEFT (`slopeL`) / RIGHT (`slopeR`) edge (0 = bottom, tileSize = top). A cell
     *  with either set is a slope (NOT also `solid`): the resolution phase rests an entity's
     *  bottom on the line between them — `0`→`tileSize` is a 45° ramp, gentler pairs are
     *  shallower, and adjacent cells sharing an edge height tile into one ramp. Purely additive. */
    slopeL: z.number().optional(),
    slopeR: z.number().optional(),
    /** Ladder: a cell flagged this is climbable — `move-platformer` (with `climbSpeed` set)
     *  suspends gravity and climbs vertically by `up`/`down` input while the entity's center
     *  is over it. Not solid. A named convenience over the catchall — purely additive. */
    ladder: z.boolean().optional(),
  })
  .catchall(z.union([z.boolean(), z.number(), z.string()]));

/** Optional tilemap for grid-based scenes. */
export const TilemapSchema = z.strictObject({
  tileSize: z.number().positive(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  /** Row-major tile indices into `tileset`; -1 (or omitted) = empty. */
  tiles: z.array(z.number().int()),
  /** Asset path of the tileset image/sheet. */
  tileset: z.string().optional(),
  /**
   * Map of tile INDEX (stringified) → property flags. An index that is absent /
   * -1 (empty) has no props. Powers `world.isBuildable` etc. without re-encoding
   * the map as entities.
   */
  properties: z.record(z.string(), TilePropsSchema).optional(),
});

/**
 * Per-scene flow contract (additive optional). Lets a scene own its outgoing
 * transitions AS DATA: when this scene emits an event named in `on`, the host
 * transitions to the mapped scene id; `persist` names the `world.state` keys
 * carried across that transition (the in-session hand-off set). Absent ⇒ the
 * full-wipe `loadScene` behavior, so a flow-less scene is byte-identical.
 */
export const SceneFlowSchema = z.strictObject({
  /** Event → target scene id. When this scene emits the event, the host transitions. */
  on: z.record(z.string(), z.string()).default({}),
  /** `world.state` keys preserved when LEAVING this scene. */
  persist: z.array(z.string()).default([]),
});

/**
 * Reserved `flow.on` targets. A flow edge may name one of these tokens instead of
 * a literal scene id; the runtime resolves it against the manifest's `levels`
 * sequence at emit time:
 *  - `"@next"` — advance to the level after the active one (or `levelsComplete` past
 *    the last; or the first level when emitted from a non-level scene like a title).
 *  - `"@first"` — (re)start at the first level (e.g. a game-over "retry" edge).
 * Using a token means a level never hard-wires its successor, so reordering or
 * inserting levels is a `manifest.levels` edit, not a per-scene rewire.
 */
export const RESERVED_FLOW_TARGETS = ["@next", "@first"] as const;
export type ReservedFlowTarget = (typeof RESERVED_FLOW_TARGETS)[number];

/** True if a `flow.on` target is a reserved level-sequence token rather than a scene id. */
export function isReservedFlowTarget(target: string): target is ReservedFlowTarget {
  return (RESERVED_FLOW_TARGETS as readonly string[]).includes(target);
}

/** Scene background: a solid CSS color or a layered (parallax) descriptor. */
export const BackgroundSchema = z.union([
  z.string(),
  z.strictObject({
    color: z.string().optional(),
    layers: z
      .array(z.strictObject({ src: z.string(), scrollX: z.number().default(0), scrollY: z.number().default(0) }))
      .optional(),
  }),
]);

/**
 * A scene: a playable composition of entities and systems within a fixed world
 * size. `{ id, entities[], systems[], tilemap?, background, music? }` is the
 * FROZEN core shape; `size` (the world/canvas bounds) is additive and defaults
 * to 800x600.
 *
 * `extends` (scene inheritance): a scene may name a BASE scene id whose shell
 * (entities, systems, size, background, music, tilemap, flow) it inherits, so
 * a multi-level game authors the shared stage ONCE and each level is a thin override
 * that only declares its own content (the layout) + a `$cfg` difficulty slice. The
 * runtime resolves the chain at boot (see `resolveSceneInheritance`); the merge is
 * additive — base entities/systems come first, then the child's, overriding by `id`.
 * Absent ⇒ a standalone scene, so the field is purely additive.
 *
 * `overrides` (entity field-level patches): the `entities` id-merge replaces an inherited
 * entity WHOLESALE, so to change one field of an inherited entity you would otherwise re-declare
 * the whole entity. An `overrides` entry is instead a `{ id, …partial }` PATCH that the resolver
 * DEEP-MERGES onto the resolved entity of that id (nested objects recurse → per-leaf override;
 * `behaviors`/`tags` arrays replace when present; absent keys inherit). It is the granular companion
 * to the wholesale `entities` merge — a level can nudge the inherited paddle's width or point a
 * behavior at a different `$cfg` slice without copying the entity. Additive optional; absent ⇒ the
 * scene resolves byte-identically. See {@link EntityOverrideSchema}.
 */
export const SceneSchema = z.strictObject({
  id: z.string().min(1),
  /** Base scene id to inherit the shared stage from (additive optional). */
  extends: z.string().min(1).optional(),
  entities: z.array(EntityDefSchema).default([]),
  systems: z.array(SystemDefSchema).default([]),
  tilemap: TilemapSchema.optional(),
  background: BackgroundSchema.optional(),
  /** Background music track key/path (resolved by the audio player). */
  music: z.string().optional(),
  /** VIEWPORT (canvas) bounds in px — what the camera shows. Defaults to 800x600. */
  size: z.strictObject({ width: z.number().positive(), height: z.number().positive() }).default({
    width: 800,
    height: 600,
  }),
  /**
   * Optional WORLD/simulation bounds in px (additive optional). The playable area the
   * runtime clamps/floors/bounces against (`world.bounds`), DECOUPLED from `size`,
   * which becomes strictly the viewport the camera shows. Absent ⇒ `world` equals
   * `size`: the camera sees the whole world and rendering is byte-identical. Set this
   * LARGER than `size` for a scrolling level — a side-
   * scroller widens it, a vertical climber heightens it — and add a `camera-follow`
   * system to move the viewport across it. The viewport (`size`) should stay constant
   * across a game's scenes (the canvas is sized once from the entry scene).
   */
  world: z.strictObject({ width: z.number().positive(), height: z.number().positive() }).optional(),
  /** Data-driven scene transitions + in-session state hand-off (additive optional). */
  flow: SceneFlowSchema.optional(),
  /**
   * Field-level patches onto entities inherited via `extends`, addressed by `id` (additive optional).
   * Each entry deep-merges onto the resolved entity of that id; absent ⇒ no patching. Resolved away
   * at boot — the runtime/renderer never see it. See {@link EntityOverrideSchema}.
   */
  overrides: z.array(EntityOverrideSchema).optional(),
});

/** The schema default for `scene.size` — used by inheritance to detect an unset size. */
export const DEFAULT_SCENE_SIZE = { width: 800, height: 600 } as const;

export type Scene = z.infer<typeof SceneSchema>;
export type Tilemap = z.infer<typeof TilemapSchema>;
export type TileProps = z.infer<typeof TilePropsSchema>;
export type SceneFlow = z.infer<typeof SceneFlowSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
