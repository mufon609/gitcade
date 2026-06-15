/**
 * The GitCade runtime: the entity-component game loop and its built-in primitives.
 * Behaviors and systems implement the FROZEN {@link BehaviorFn}/{@link SystemFn}
 * contracts; the {@link Game} host runs them both in-browser (rAF) and headless
 * (`stepFrames`).
 */
export { Game, DEFAULT_FIXED_DT, type GameOptions } from "./game.js";
export { World, type WorldOptions } from "./world.js";
export { Entity, type BehaviorInstance, type AnimationState } from "./entity.js";
export { Registry, type BehaviorRegistration, type SystemRegistration } from "./registry.js";
export { EventBus, type GameEvent } from "./eventbus.js";
export { Input, type Pointer, type Tap } from "./input.js";
export { AudioPlayer } from "./audio.js";
export { Renderer } from "./renderer.js";
export { buildEntity } from "./entity-factory.js";
export { resolveParams, num, str, bool, strArray } from "./params.js";
export { aabbOverlap, entitiesOverlap, overlapAxis, type AABB } from "./collision.js";
export { createDefaultRegistry } from "./defaults.js";
export type { BehaviorFn, SystemFn, ResolvedParams, ParamSpec } from "./types.js";

export {
  BUILTIN_BEHAVIOR_TYPES,
  registerBuiltinBehaviors,
  velocity,
  keyboardAxis,
  clampToWorld,
  bounceWorldEdges,
  reflectOnHit,
  followEntityAxis,
  scoreZone,
  spriteAnimate,
} from "./behaviors/index.js";
export {
  BUILTIN_SYSTEM_TYPES,
  registerBuiltinSystems,
  aabbCollision,
  winCondition,
} from "./systems/index.js";
