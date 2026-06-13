import { z } from "zod";
import { EntityDefSchema } from "./entity.js";
import { SystemDefSchema } from "./system.js";

/** Optional tilemap for grid-based scenes. Minimal in v1; Phase 2 supplies tilesets. */
export const TilemapSchema = z.object({
  tileSize: z.number().positive(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  /** Row-major tile indices into `tileset`; -1 (or omitted) = empty. */
  tiles: z.array(z.number().int()),
  /** Asset path of the tileset image/sheet. */
  tileset: z.string().optional(),
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
});

export type Scene = z.infer<typeof SceneSchema>;
export type Tilemap = z.infer<typeof TilemapSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
