import type { Entity } from "./entity.js";
import type { World } from "./world.js";

/**
 * Resolved behavior/system params: the authored params with every `$cfg.<path>`
 * reference replaced by its `config.json` value. Behaviors receive these, never
 * the raw refs, so balance lookups are O(1) at tick time.
 */
export type ResolvedParams = Record<string, unknown>;

/**
 * THE BEHAVIOR CONTRACT — frozen at the end of Phase 1.
 *
 * A behavior is a "pure-ish" function invoked once per entity per fixed update:
 * it reads `entity`/`world` and mutates them (and only them) in place. It must
 * not retain module-level mutable state, perform I/O, or schedule timers — all
 * side effects go through the `world` API (spawn/destroy/events/audio/storage),
 * which keeps behaviors deterministic and unit-testable.
 *
 * @param entity The entity this behavior is attached to.
 * @param world  The shared world API (entities, input, events, audio, storage, config).
 * @param params The `$cfg`-resolved params for THIS behavior instance.
 * @param dt     Fixed timestep delta in seconds.
 */
export type BehaviorFn = (entity: Entity, world: World, params: ResolvedParams, dt: number) => void;

/**
 * THE SYSTEM CONTRACT — frozen at the end of Phase 1.
 *
 * A system runs once per fixed update over the WHOLE world (collision detection,
 * HUD, win/lose checks, spawners). Same purity expectations as behaviors.
 *
 * @param world  The shared world API.
 * @param params The `$cfg`-resolved params for this system instance.
 * @param dt     Fixed timestep delta in seconds.
 */
export type SystemFn = (world: World, params: ResolvedParams, dt: number) => void;

/**
 * Optional Zod-or-predicate param schema a behavior/system type may register so
 * the runtime/validator can type-check its params. Kept as a loose `parse`
 * surface to avoid forcing Zod on third-party part authors.
 */
export interface ParamSpec {
  parse(params: ResolvedParams): ResolvedParams;
}
