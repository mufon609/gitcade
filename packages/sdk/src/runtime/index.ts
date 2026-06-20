/**
 * The GitCade runtime: the entity-component game loop and its built-in primitives.
 * Behaviors and systems implement the FROZEN {@link BehaviorFn}/{@link SystemFn}
 * contracts; the {@link Game} host runs them both in-browser (rAF) and headless
 * (`stepFrames`).
 */
export { Game, DEFAULT_FIXED_DT, type GameOptions } from "./game.js";
export { World, type WorldOptions, type Camera } from "./world.js";
// The engine-independent transcendental seam exposed as `world.math` (additive). Behaviors and
// systems reach it via the World; the named exports let tests + the runtime internals use it
// directly, and `CanonicalMath` is the shared frozen singleton every World references.
export {
  CanonicalMath,
  type MathOps,
  sin,
  cos,
  tan,
  atan,
  atan2,
  asin,
  acos,
  exp,
  log,
  pow,
  powInt,
  hypot,
} from "./fdmath.js";
export { Entity, type BehaviorInstance, type AnimationState, type BodyComponent } from "./entity.js";
export { Registry, type BehaviorRegistration, type SystemRegistration } from "./registry.js";
export { EventBus, type GameEvent } from "./eventbus.js";
export { Input, type Pointer, type Tap, type ActionBinding } from "./input.js";
export { AudioPlayer } from "./audio.js";
export { Renderer } from "./renderer.js";
export { buildEntity } from "./entity-factory.js";
export { resolveParams, num, str, bool, strArray, cooldown } from "./params.js";
export {
  aabbOverlap,
  entitiesOverlap,
  overlapAxis,
  resolveSolids,
  resolveSlopes,
  applyContacts,
  type AABB,
  type SolidRect,
  type MovingBody,
  type SolidContacts,
  type SlopeCell,
  type SlopeContact,
} from "./collision.js";
export { advanceAnim } from "./anim.js";
export { createDefaultRegistry } from "./defaults.js";
export type { BehaviorFn, SystemFn, ResolvedParams, ParamSpec } from "./types.js";

// Determinism conformance: the seedable RNG, a byte-stable state snapshot, and the
// twice-run check that proves a game reproduces under a fixed seed + input (additive).
export {
  seededRng,
  snapshotWorld,
  runDeterminismCheck,
  assertDeterministic,
  scriptedConformanceInput,
  type DeterminismOptions,
  type DeterminismReport,
} from "./determinism.js";

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
