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
 */
export const SceneSchema = z.object({
  id: z.string().min(1),
  entities: z.array(EntityDefSchema).default([]),
  systems: z.array(SystemDefSchema).default([]),
  tilemap: TilemapSchema.optional(),
  background: BackgroundSchema.optional(),
  /** Background music track key/path (resolved by the audio player). */
  music: z.string().optional(),
  /** World/canvas bounds in px. Defaults to 800x600. */
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).default({
    width: 800,
    height: 600,
  }),
  /** Data-driven scene transitions + in-session state hand-off (0.2.0 additive, G1). */
  flow: SceneFlowSchema.optional(),
});

export type Scene = z.infer<typeof SceneSchema>;
export type Tilemap = z.infer<typeof TilemapSchema>;
export type TileProps = z.infer<typeof TilePropsSchema>;
export type SceneFlow = z.infer<typeof SceneFlowSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
