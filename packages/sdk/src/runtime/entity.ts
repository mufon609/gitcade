import type { Sprite } from "../schema/sprite.js";
import type { ResolvedParams } from "./types.js";
import type { BehaviorFn } from "./types.js";

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
    tags?: string[];
    sprite: Sprite;
    state?: Record<string, unknown>;
  }) {
    this.id = init.id;
    this.x = init.x;
    this.y = init.y;
    this.w = init.w;
    this.h = init.h;
    this.layer = init.layer;
    this.zIndex = init.zIndex ?? init.layer;
    this.rotation = init.rotation ?? 0;
    this.scaleX = init.scale ?? 1;
    this.scaleY = init.scale ?? 1;
    this.tags = new Set(init.tags ?? []);
    this.sprite = init.sprite;
    this.state = init.state ?? {};
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
}
