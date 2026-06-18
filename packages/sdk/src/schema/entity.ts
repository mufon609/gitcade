import { z } from "zod";
import { Vec2Schema, SizeSchema } from "./common.js";
import { SpriteSchema } from "./sprite.js";
import { BehaviorDefSchema } from "./behavior.js";

/**
 * An entity definition: a positioned, sized, tagged thing that composes behaviors.
 *
 * `{ id, sprite, size, position, behaviors[], tags[], layer }` is the FROZEN
 * Phase 1 shape. Optional presentational/transform fields (`rotation`, `scale`,
 * `zIndex`, `opacity`, `visible`), an optional initial `state` bag, and the optional
 * scene-graph link (`parent` + `local`) are additive and do not change the frozen core.
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
  /** Rotation in RADIANS (clockwise), applied around the entity center by the renderer
   *  since 0.3.2. Default 0. Collision/picking stay axis-aligned (visual only). The
   *  library `face-angle` behavior writes this from velocity/target/pointer/tilt. */
  rotation: z.number().optional(),
  /** Uniform scale factor applied around the entity center by the renderer since 0.3.2
   *  (maps to both scaleX/scaleY). Default 1. Visual only — collision uses the base size. */
  scale: z.number().optional(),
  /** Opacity 0..1, applied by the renderer as `globalAlpha` (0.7.0). Default 1 (opaque).
   *  Visual only — a behavior writes `entity.opacity` at runtime to fade / damage-flash /
   *  i-frame-flicker an entity. (The `opacity`/`alpha` keys were whitelisted but the
   *  renderer never honored them — a declared-but-ignored slot, now wired.) */
  opacity: z.number().min(0).max(1).optional(),
  /** Visibility toggle: the renderer SKIPS an entity with `visible:false` (0.7.0). Default
   *  true. A behavior flips it at runtime to hide/show an entity (e.g. a hover preview)
   *  without parking it off-screen. Visual only — a hidden entity still simulates. */
  visible: z.boolean().optional(),
  state: z.record(z.string(), z.unknown()).optional(),

  // Scene-graph link (0.9.0 additive). Absent ⇒ a root entity (every pre-0.9 entity):
  // `position`/`rotation`/`scale` are its WORLD transform exactly as before, so a scene
  // with no parenting is byte-identical. When `parent` is set, the runtime derives this
  // entity's WORLD transform each tick from the parent's world transform composed with
  // `local` (a transform-resolution phase after behaviors), so a carried item / turret /
  // multi-part body / attached HUD tracks its parent. `position` stays world-space (the
  // initial/fallback world transform); the parent-relative offset lives in `local` — NOT
  // overloaded onto `position`, so no frozen field changes meaning.
  /** Id of the parent entity (within the resolved scene) whose transform this one rides. */
  parent: z.string().min(1).optional(),
  /**
   * This entity's transform in the PARENT's frame (only meaningful with `parent` set).
   * `x`/`y` are the offset in parent-local px (default 0); `rotation` (radians) and `scale`
   * (uniform) reuse the `rotation`/`scale` conventions above (defaults 0 / 1). Absent ⇒ the
   * child sits exactly at the parent's origin, unrotated, unscaled.
   */
  local: z
    .object({
      x: z.number().default(0),
      y: z.number().default(0),
      rotation: z.number().optional(),
      scale: z.number().optional(),
    })
    .optional(),

  /** Catalog provenance for this entity, e.g. `"enemy-chaser@1.0.0"`. */
  part: z.string().optional(),
});

export type EntityDef = z.infer<typeof EntityDefSchema>;
