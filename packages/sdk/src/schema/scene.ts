import { z } from "zod";
import { EntityDefSchema } from "./entity.js";
import { SystemDefSchema } from "./system.js";

/**
 * Per-tile-INDEX property flags (0.2.0 additive, G3). Open-ended: the three named
 * flags are conveniences; `catchall` keeps it usable for game-specific markers
 * (e.g. `{ "1": { lane: true, walkable: true, buildable: false } }`). Presentational/
 * structural data, so exempt from the magic-number rule like the rest of the tilemap.
 */
export const TilePropsSchema = z
  .object({
    buildable: z.boolean().optional(),
    walkable: z.boolean().optional(),
    lane: z.boolean().optional(),
    /** Solid terrain: the library `tilemap-collide` behavior resolves entity AABBs
     *  against any cell flagged this (the platformer floor/wall/ceiling). A named
     *  convenience over the catchall — purely additive (0.7.0). */
    solid: z.boolean().optional(),
  })
  .catchall(z.union([z.boolean(), z.number(), z.string()]));

/** Optional tilemap for grid-based scenes. Minimal in v1; Phase 2 supplies tilesets. */
export const TilemapSchema = z.object({
  tileSize: z.number().positive(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  /** Row-major tile indices into `tileset`; -1 (or omitted) = empty. */
  tiles: z.array(z.number().int()),
  /** Asset path of the tileset image/sheet. */
  tileset: z.string().optional(),
  /**
   * Map of tile INDEX (stringified) → property flags (0.2.0 additive, G3). An
   * index that is absent / -1 (empty) has no props. Powers `world.isBuildable`
   * etc. without re-encoding the map as entities.
   */
  properties: z.record(z.string(), TilePropsSchema).optional(),
});

/**
 * Per-scene flow contract (0.2.0 additive, G1 keystone). Lets a scene own its
 * outgoing transitions AS DATA: when this scene emits an event named in `on`, the
 * host transitions to the mapped scene id; `persist` names the `world.state` keys
 * carried across that transition (the in-session hand-off set). Absent ⇒ today's
 * full-wipe `loadScene` behavior, so 0.1.x scenes are byte-identical.
 */
export const SceneFlowSchema = z.object({
  /** Event → target scene id. When this scene emits the event, the host transitions. */
  on: z.record(z.string(), z.string()).default({}),
  /** `world.state` keys preserved when LEAVING this scene. */
  persist: z.array(z.string()).default([]),
});

/**
 * Reserved `flow.on` targets (0.6.0, E11). A flow edge may name one of these tokens
 * instead of a literal scene id; the runtime resolves it against the manifest's
 * `levels` sequence at emit time:
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

/** Scene background: a solid CSS color or a layered descriptor (parallax in 2B). */
export const BackgroundSchema = z.union([
  z.string(),
  z.object({
    color: z.string().optional(),
    layers: z
      .array(z.object({ src: z.string(), scrollX: z.number().default(0), scrollY: z.number().default(0) }))
      .optional(),
  }),
]);

/**
 * A scene: a playable composition of entities and systems within a fixed world
 * size. `{ id, entities[], systems[], tilemap?, background, music? }` is the
 * FROZEN Phase 1 shape; `size` (the world/canvas bounds) is additive and defaults
 * to 800x600.
 *
 * `extends` (0.6.0, E11 scene inheritance): a scene may name a BASE scene id whose
 * shell (entities, systems, size, background, music, tilemap, flow) it inherits, so
 * a multi-level game authors the shared stage ONCE and each level is a thin override
 * that only declares its own content (the layout) + a `$cfg` difficulty slice. The
 * runtime resolves the chain at boot (see `resolveSceneInheritance`); the merge is
 * additive — base entities/systems come first, then the child's, overriding by `id`.
 * Absent ⇒ a standalone scene (every 0.x scene), so the field is purely additive.
 */
export const SceneSchema = z.object({
  id: z.string().min(1),
  /** Base scene id to inherit the shared stage from (0.6.0 additive, E11). */
  extends: z.string().min(1).optional(),
  entities: z.array(EntityDefSchema).default([]),
  systems: z.array(SystemDefSchema).default([]),
  tilemap: TilemapSchema.optional(),
  background: BackgroundSchema.optional(),
  /** Background music track key/path (resolved by the audio player). */
  music: z.string().optional(),
  /** VIEWPORT (canvas) bounds in px — what the camera shows. Defaults to 800x600. */
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).default({
    width: 800,
    height: 600,
  }),
  /**
   * Optional WORLD/simulation bounds in px (0.7.0 additive). The playable area the
   * runtime clamps/floors/bounces against (`world.bounds`), DECOUPLED from `size`,
   * which becomes strictly the viewport the camera shows. Absent ⇒ `world` equals
   * `size` (every pre-0.7 scene): the camera sees the whole world and rendering is
   * byte-identical. Set this LARGER than `size` for a scrolling level — a side-
   * scroller widens it, a vertical climber heightens it — and add a `camera-follow`
   * system to move the viewport across it. The viewport (`size`) should stay constant
   * across a game's scenes (the canvas is sized once from the entry scene).
   */
  world: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  /** Data-driven scene transitions + in-session state hand-off (0.2.0 additive, G1). */
  flow: SceneFlowSchema.optional(),
});

/** The schema default for `scene.size` — used by inheritance to detect an unset size. */
export const DEFAULT_SCENE_SIZE = { width: 800, height: 600 } as const;

export type Scene = z.infer<typeof SceneSchema>;
export type Tilemap = z.infer<typeof TilemapSchema>;
export type TileProps = z.infer<typeof TilePropsSchema>;
export type SceneFlow = z.infer<typeof SceneFlowSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
