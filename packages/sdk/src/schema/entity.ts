import { z } from "zod";
import { Vec2Schema, SizeSchema } from "./common.js";
import { SpriteSchema } from "./sprite.js";
import { BehaviorDefSchema } from "./behavior.js";

/**
 * How an entity participates in the unified collision-resolution phase (`World.resolveBodies`) —
 * the typed, first-class model for what a body IS, resolved in exactly one place rather than via
 * order-sensitive resolver behaviors.
 *
 * Additive optional field: an entity WITHOUT a `collider` is never touched by the phase, so every
 * arcade scene is byte-identical (the phase no-ops over it exactly as `resolveHierarchy` no-ops
 * over an unparented entity).
 *
 *  - `role: "dynamic"` — the body MOVES and is resolved (pushed out of solids, velocity zeroed on
 *    contact, contact flags written to `entity.body.contacts`). `role: "solid"` — an immovable
 *    blocker a dynamic resolves against (it still moves via its own behaviors, e.g. a tween/velocity
 *    lift; it is just never itself resolved). A solid is effectively infinite-mass.
 *  - `oneWay` — a solid that blocks ONLY on its top face: a dynamic lands on it from above but
 *    jumps up through it and passes it sideways (the entity mirror of a one-way tile). Default false.
 *  - `carriable` — a moving `solid` that CARRIES riders standing on it: a dynamic resting on its top
 *    inherits the carrier's per-tick displacement (horizontal always, descending too), so it rides a
 *    sliding/sinking platform and can still walk while carried. Default false. (Vertical-UP carry
 *    already comes free from the push-out — a rising carrier pushes the rider up.)
 *  - `pushable` — a `dynamic` a pusher can shove SIDEWAYS: when another dynamic drives into its side,
 *    it slides along (a crate). Default false. Push is horizontal only — a body standing ON a crate
 *    is out of scope (a pushable is not solid-to-dynamics). Needs `role:"dynamic"`.
 *  - `mass` — push split weight (default 1): when two `pushable` bodies meet, the lighter moves more;
 *    a NON-pushable pusher (the player) is effectively immovable in the split (the crate yields), and
 *    a crate wedged against a solid becomes immovable in turn (the pusher then stops against it).
 *  - `inset` — shrinks the collider box in from the sprite AABB by `x`/`y` px per side (a 24px
 *    sprite with `inset.x:4` collides as 16px wide), for fairer corner-clip / contact geometry.
 *    Default `{0,0}` (collider == sprite box). Structural geometry like `size`/`position`, so it is
 *    NOT subject to the no-magic-numbers rule (that rule scans only behavior/system `params`).
 */
export const ColliderSchema = z.strictObject({
  role: z.enum(["dynamic", "solid"]),
  oneWay: z.boolean().default(false),
  carriable: z.boolean().default(false),
  pushable: z.boolean().default(false),
  mass: z.number().positive().default(1),
  inset: z.strictObject({ x: z.number().default(0), y: z.number().default(0) }).default({ x: 0, y: 0 }),
});

export type ColliderDef = z.infer<typeof ColliderSchema>;

/**
 * An entity definition: a positioned, sized, tagged thing that composes behaviors.
 *
 * `{ id, sprite, size, position, behaviors[], tags[], layer }` is the FROZEN
 * core shape. Optional presentational/transform fields (`rotation`, `scale`,
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
export const EntityDefSchema = z.strictObject({
  id: z.string().min(1),
  sprite: SpriteSchema.default({ kind: "none" }),
  size: SizeSchema.default({ w: 16, h: 16 }),
  position: Vec2Schema.default({ x: 0, y: 0 }),
  behaviors: z.array(BehaviorDefSchema).default([]),
  tags: z.array(z.string()).default([]),
  layer: z.number().int().default(0),

  // Additive optional fields (not part of the frozen core shape):
  zIndex: z.number().int().optional(),
  /** Rotation in RADIANS (clockwise), applied around the entity center by the renderer.
   *  Default 0. Collision/picking stay axis-aligned (visual only). The library
   *  `face-angle` behavior writes this from velocity/target/pointer/tilt. */
  rotation: z.number().optional(),
  /** Uniform scale factor applied around the entity center by the renderer (maps to both
   *  scaleX/scaleY). Default 1. Visual only — collision uses the base size. */
  scale: z.number().optional(),
  /** Opacity 0..1, applied by the renderer as `globalAlpha`. Default 1 (opaque). Visual
   *  only — a behavior writes `entity.opacity` at runtime to fade / damage-flash /
   *  i-frame-flicker an entity. */
  opacity: z.number().min(0).max(1).optional(),
  /** Visibility toggle: the renderer SKIPS an entity with `visible:false`. Default true.
   *  A behavior flips it at runtime to hide/show an entity (e.g. a hover preview) without
   *  parking it off-screen. Visual only — a hidden entity still simulates. */
  visible: z.boolean().optional(),
  state: z.record(z.string(), z.unknown()).optional(),

  // Scene-graph link (additive optional). Absent ⇒ a root entity:
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
    .strictObject({
      x: z.number().default(0),
      y: z.number().default(0),
      rotation: z.number().optional(),
      scale: z.number().optional(),
    })
    .optional(),

  /**
   * How this entity participates in the unified collision-resolution phase (additive optional).
   * Absent ⇒ the entity is invisible to the phase (every arcade scene), so a scene with no
   * collider is byte-identical. See {@link ColliderSchema}.
   */
  collider: ColliderSchema.optional(),

  /** Catalog provenance for this entity, e.g. `"enemy-chaser@1.0.0"`. */
  part: z.string().optional(),
});

export type EntityDef = z.infer<typeof EntityDefSchema>;
