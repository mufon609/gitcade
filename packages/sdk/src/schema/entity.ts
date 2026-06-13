import { z } from "zod";
import { Vec2Schema, SizeSchema } from "./common.js";
import { SpriteSchema } from "./sprite.js";
import { BehaviorDefSchema } from "./behavior.js";

/**
 * An entity definition: a positioned, sized, tagged thing that composes behaviors.
 *
 * `{ id, sprite, size, position, behaviors[], tags[], layer }` is the FROZEN
 * Phase 1 shape. Optional presentational/transform fields (`rotation`, `scale`,
 * `zIndex`) and an optional initial `state` bag are additive and do not change
 * the frozen core.
 *
 * - `id` is unique within a scene; tag queries and `world.byId` use it.
 * - `behaviors[]` are behavior instances run every tick (see {@link BehaviorDefSchema}).
 * - `tags[]` drive collision pairing, queries, and targeting.
 * - `layer` is the draw layer; higher draws later (on top).
 * - `state` seeds the runtime entity's scratch bag (e.g. `{ hp: 3 }`); behaviors
 *   read/write it. Initial state values are data, not balance, but authors are
 *   encouraged to seed numeric state via `$cfg` in a behavior instead.
 */
export const EntityDefSchema = z.object({
  id: z.string().min(1),
  sprite: SpriteSchema.default({ kind: "none" }),
  size: SizeSchema.default({ w: 16, h: 16 }),
  position: Vec2Schema.default({ x: 0, y: 0 }),
  behaviors: z.array(BehaviorDefSchema).default([]),
  tags: z.array(z.string()).default([]),
  layer: z.number().int().default(0),

  // Additive optional fields (not part of the frozen core shape):
  zIndex: z.number().int().optional(),
  rotation: z.number().optional(),
  scale: z.number().optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  /** Catalog provenance for this entity, e.g. `"enemy-chaser@1.0.0"`. */
  part: z.string().optional(),
});

export type EntityDef = z.infer<typeof EntityDefSchema>;
