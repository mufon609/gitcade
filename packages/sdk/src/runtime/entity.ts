import type { Sprite } from "../schema/sprite.js";
import type { ResolvedParams } from "./types.js";
import type { BehaviorFn } from "./types.js";
import type { SolidContacts } from "./collision.js";

/** A live behavior attached to an entity. `params` are already `$cfg`-resolved. */
export interface BehaviorInstance {
  id: string;
  type: string;
  fn: BehaviorFn;
  params: ResolvedParams;
  /**
   * This instance's PRIVATE per-tick-persistent working state (coyote/jump-buffer timers, an
   * animation state machine's current clip, an AI's patrol index) — isolated from other
   * behaviors and from the entity's shared `state` bag, and handed to the behavior each tick.
   * Distinct from {@link Entity.state} (a cross-behavior channel) and {@link Entity.local}
   * (the parenting transform). Starts empty.
   */
  scratch: Record<string, unknown>;
}

/** Sprite-sheet animation playback state, advanced by the `sprite-animate` behavior. */
export interface AnimationState {
  current: string | null;
  frame: number;
  elapsed: number;
}

/**
 * A transform in a PARENT entity's frame (0.9.0 scene graph): `x`/`y` offset in parent-local
 * px, `rotation` in radians, `scale` uniform. The hierarchy-resolution phase composes this
 * with the parent's WORLD transform to derive a parented entity's world transform each tick.
 * Identity (`{0,0,0,1}`) for a root entity.
 */
export interface LocalTransform {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

/**
 * A resolved {@link ColliderSchema} living on the body — how this entity participates in the
 * unified collision-resolution phase ({@link World.resolveBodies}, 1.1.0). The runtime mirror of
 * the authored `collider` field (defaults already applied by the factory), so the phase reads one
 * typed shape with no per-tick parsing. `undefined` ⇒ no collider ⇒ the phase skips the entity.
 */
export interface ColliderComponent {
  /** `"dynamic"` = moves + gets resolved; `"solid"` = an immovable blocker dynamics resolve against. */
  role: "dynamic" | "solid";
  /** Solid only on its top face (a pass-through ledge) — land from above, jump up through. */
  oneWay: boolean;
  /** A moving `solid` that carries riders standing on its top (inherit its per-tick displacement). */
  carriable: boolean;
  /** A `dynamic` a pusher can shove sideways (a crate). */
  pushable: boolean;
  /** Push split weight; the lighter of two pushables moves more (a non-pushable pusher is immovable). */
  mass: number;
  /** Collider-box inset from the sprite AABB, in px per side (`{0,0}` ⇒ collider == sprite box). */
  inset: { x: number; y: number };
}

/**
 * A physics body's per-tick runtime state — the engine-INTERNAL collision + motion scratch
 * grouped off the flat {@link Entity} into one typed component. Runtime-only: never serialized,
 * never authored, and not part of what games read off the `(entity, world, params, dt)` behavior
 * surface (the resolvers/movers write and read it; the seed games do not touch it). Every entity
 * carries one, so a resolver can write contacts and a mover can read them with no allocation.
 */
export interface BodyComponent {
  /**
   * Position at the START of the current tick, snapshotted by the host loop so `x - body.prevX` /
   * `y - body.prevY` is this tick's WORLD delta — read by carry (a rider inherits a moving
   * platform's per-tick delta) and the groundwork render interpolation needs. Seeded to the spawn
   * position (delta 0 on the first tick).
   */
  prevX: number;
  prevY: number;
  /**
   * Solid-CONTACT sensing for the current tick: which faces touched a solid. Written by
   * {@link applyContacts} (fed by the `tilemap-collide` / `solid-collide` resolvers) and read by
   * movers/animators (`move-platformer` jump test, `sprite-state-machine` grounded state). The
   * flags are MOTION-derived (a face is reported on the axis the body moved INTO a solid), so a
   * body resting motionless reports none.
   */
  contacts: SolidContacts;
  /**
   * Frame stamp of the last {@link applyContacts} write. Lets multiple resolvers in ONE tick
   * MERGE their contacts (the first this tick resets {@link BodyComponent.contacts}, later ones
   * OR-in) instead of clobbering. Not part of the sensed-contact contract; touched only by
   * {@link applyContacts}.
   */
  contactTick: number;
  /**
   * Drop-through window remaining in seconds: the mover→resolver half of the contact protocol.
   * `move-platformer` sets it on a one-way drop (down+jump); the solid resolvers read it (>0) and
   * drop one-way cells/ledges from the solid set so a standing body falls through.
   */
  dropThrough: number;
  /**
   * How this entity participates in the unified collision-resolution phase (1.1.0), resolved from
   * the authored `collider` field by the entity factory. `undefined` for a non-colliding entity
   * (every arcade entity), which is what makes {@link World.resolveBodies} a no-op over it.
   */
  collider?: ColliderComponent;
}

/**
 * A runtime entity. Position/size/velocity are first-class fields (the
 * transform + velocity built-in primitive); arbitrary per-entity scratch data
 * lives in {@link Entity.state}. Behaviors mutate these directly each tick — this
 * is the data side of the FROZEN `(entity, world, params, dt)` behavior contract.
 */
export class Entity {
  /** Unique within a scene. */
  id: string;
  /** Position of the entity's top-left, in world px. */
  x: number;
  y: number;
  /** Size in px. */
  w: number;
  h: number;
  /** Velocity in px/sec (integrated by the `velocity` behavior). */
  vx = 0;
  vy = 0;
  rotation = 0;
  scaleX = 1;
  scaleY = 1;
  /** Opacity 0..1, applied by the renderer as `globalAlpha` (0.7.0). Visual only;
   *  a behavior writes it to fade / damage-flash / i-frame-flicker. Default 1 (opaque). */
  opacity = 1;
  /** When false, the renderer skips this entity (0.7.0). Visual only — it still
   *  simulates (behaviors/collision run). Default true. */
  visible = true;
  /** Draw layer; higher draws on top. */
  layer: number;
  zIndex: number;
  tags: Set<string>;
  sprite: Sprite;
  anim: AnimationState = { current: null, frame: 0, elapsed: 0 };
  behaviors: BehaviorInstance[] = [];
  /** Arbitrary scratch state for behaviors (hp, cooldowns, flags). */
  state: Record<string, unknown>;
  /** Entities overlapping this one this tick (populated by the collision system). */
  collisions: Entity[] = [];
  /**
   * Physics-body runtime state — contacts, drop-through, and the pre-tick position — grouped
   * off the flat transform into one typed unit (see {@link BodyComponent}). The home of the
   * platformer contact protocol + the carry/interpolation motion history; runtime-only (never
   * serialized), so a parentless arcade scene never touches it.
   */
  body: BodyComponent = {
    prevX: 0,
    prevY: 0,
    contacts: { onGround: false, onCeiling: false, onWallL: false, onWallR: false, onOneWay: false },
    contactTick: -1,
    dropThrough: 0,
  };
  /**
   * Id of the PARENT entity this one's world transform is derived from (0.9.0 scene graph);
   * undefined ⇒ a root entity whose `x`/`y`/`rotation`/`scaleX`/`scaleY` are authoritative.
   * Set from the `parent` schema field at build or by {@link attachTo} at runtime; read by
   * the hierarchy-resolution phase ({@link World.resolveHierarchy}).
   */
  parentId?: string;
  /**
   * This entity's transform in its PARENT's frame (0.9.0). Only consulted when
   * {@link parentId} is set: the hierarchy phase composes the parent's WORLD transform with
   * this to WRITE this entity's world `x`/`y`/`rotation`/`scaleX`/`scaleY`. Identity (origin,
   * unrotated, ×1) by default — seeded from the `local` schema field for a parented entity.
   */
  local: LocalTransform = { x: 0, y: 0, rotation: 0, scale: 1 };
  /** False once destroyed; pruned at end of tick. */
  alive = true;

  constructor(init: {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    layer: number;
    zIndex?: number;
    rotation?: number;
    scale?: number;
    opacity?: number;
    visible?: boolean;
    tags?: string[];
    sprite: Sprite;
    state?: Record<string, unknown>;
    parentId?: string;
    local?: Partial<LocalTransform>;
  }) {
    this.id = init.id;
    this.x = init.x;
    this.y = init.y;
    this.body.prevX = init.x;
    this.body.prevY = init.y;
    this.w = init.w;
    this.h = init.h;
    this.layer = init.layer;
    this.zIndex = init.zIndex ?? init.layer;
    this.rotation = init.rotation ?? 0;
    this.scaleX = init.scale ?? 1;
    this.scaleY = init.scale ?? 1;
    this.opacity = init.opacity ?? 1;
    this.visible = init.visible ?? true;
    this.tags = new Set(init.tags ?? []);
    this.sprite = init.sprite;
    this.state = init.state ?? {};
    this.parentId = init.parentId;
    if (init.local) {
      this.local = {
        x: init.local.x ?? 0,
        y: init.local.y ?? 0,
        rotation: init.local.rotation ?? 0,
        scale: init.local.scale ?? 1,
      };
    }
  }

  hasTag(tag: string): boolean {
    return this.tags.has(tag);
  }

  /** Center point (used by AI targeting, reflection). */
  get cx(): number {
    return this.x + this.w / 2;
  }
  get cy(): number {
    return this.y + this.h / 2;
  }

  /** Attach a behavior at runtime (the detach/attach half of the contract). */
  addBehavior(instance: BehaviorInstance): void {
    this.behaviors.push(instance);
  }

  /** Detach a behavior by instance id or type. Returns how many were removed. */
  removeBehavior(idOrType: string): number {
    const before = this.behaviors.length;
    this.behaviors = this.behaviors.filter((b) => b.id !== idOrType && b.type !== idOrType);
    return before - this.behaviors.length;
  }

  /**
   * Attach to `parent` so this entity's WORLD transform is derived from the parent's each tick
   * (0.9.0 scene graph — carried items, riders, multi-part bodies, attached HUD/FX). With
   * `local` given, that becomes the parent-frame offset; with it OMITTED, the entity's CURRENT
   * world gap to the parent is captured as the offset (the inverse of the hierarchy compose),
   * so a runtime pickup holds the child's on-screen position with no teleport. Takes effect on
   * the next {@link World.resolveHierarchy} phase.
   */
  attachTo(parent: Entity, local?: Partial<LocalTransform>): void {
    this.parentId = parent.id;
    if (local) {
      this.local = {
        x: local.x ?? 0,
        y: local.y ?? 0,
        rotation: local.rotation ?? 0,
        scale: local.scale ?? 1,
      };
      return;
    }
    // Capture the current world delta in the parent's local frame: inverse-rotate the world
    // gap by the parent's rotation, then unscale per axis. Exactly inverts the compose the
    // hierarchy phase applies, so `world = parent ∘ local` reproduces today's on-screen pose.
    const sx = parent.scaleX || 1;
    const sy = parent.scaleY || 1;
    const cosP = Math.cos(parent.rotation);
    const sinP = Math.sin(parent.rotation);
    const dx = this.x - parent.x;
    const dy = this.y - parent.y;
    this.local = {
      x: (dx * cosP + dy * sinP) / sx,
      y: (-dx * sinP + dy * cosP) / sy,
      rotation: this.rotation - parent.rotation,
      scale: this.scaleX / sx,
    };
  }

  /**
   * Detach from a parent (0.9.0), leaving the entity at its current WORLD transform so it
   * becomes a root again (no snap-back) — the drop half of a pickup/drop. Safe if unparented.
   */
  detach(): void {
    this.parentId = undefined;
  }
}
