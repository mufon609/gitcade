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
  /**
   * Position at the START of the current tick (0.10.0), snapshotted by the host loop so
   * `x - prevX` / `y - prevY` is this tick's WORLD delta. Read by carry (`ride-platform`: a
   * rider inherits a moving platform's per-tick delta) and the groundwork a future render-
   * interpolation pass needs. Seeded to the spawn position (delta 0 on tick 1).
   */
  prevX = 0;
  prevY = 0;
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
   * Solid-CONTACT sensing for the current tick (0.8.0): which faces touched a solid this
   * tick. Written by the SDK's {@link applyContacts} (fed by the library `tilemap-collide`/
   * `solid-collide` resolvers) and read by movers/animators (`move-platformer` jump test,
   * `sprite-state-machine` grounded state). The FIRST-CLASS, typed home of the platformer
   * contact protocol, mirroring the typed `collisions`/`anim` runtime fields. Runtime-only
   * (never serialized); defaults all-false. The flags are MOTION-derived (a face is reported
   * on the axis the body moved INTO a solid), so a body resting motionless reports none.
   */
  contacts: SolidContacts = { onGround: false, onCeiling: false, onWallL: false, onWallR: false, onOneWay: false };
  /**
   * Drop-through window remaining in seconds (0.8.0): the mover→resolver half of the contact
   * protocol. `move-platformer` sets it on a one-way drop (down+jump); the solid resolvers
   * read it (>0) and drop one-way cells/ledges from the solid set so a standing body falls
   * through. Runtime-only; default 0 (not dropping).
   */
  dropThrough = 0;
  /**
   * Internal frame stamp of the last {@link applyContacts} write (0.8.0). Lets multiple
   * resolvers in ONE tick MERGE their contacts (the first this tick resets {@link contacts},
   * later ones OR-in) instead of clobbering. Not part of the sensed-contact contract;
   * touched only by {@link applyContacts}.
   */
  contactTick = -1;
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
    this.prevX = init.x;
    this.prevY = init.y;
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
