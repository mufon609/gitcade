import type { Entity } from "./entity.js";
import type { World } from "./world.js";

/**
 * Resolved behavior/system params: the authored params with every `$cfg.<path>`
 * reference replaced by its `config.json` value. Behaviors receive these, never
 * the raw refs, so balance lookups are O(1) at tick time.
 */
export type ResolvedParams = Record<string, unknown>;

/**
 * THE BEHAVIOR CONTRACT.
 *
 * A behavior is a "pure-ish" function invoked once per entity per fixed update:
 * it reads `entity`/`world` and mutates them (and only them) in place. It must
 * not retain MODULE-level mutable state or perform I/O — all side effects go
 * through the `world` API (spawn/destroy/events/audio/storage, plus deterministic
 * one-shot scheduling via `world.after`), which keeps behaviors deterministic and
 * unit-testable. Per-instance cooldowns use the {@link cooldown} helper over `scratch`.
 *
 * PER-INSTANCE private working state (coyote/jump-buffer timers, an animation
 * state-machine's current clip, an AI's patrol index) lives in `scratch` — the
 * behavior instance's own `Record`, isolated from every other behavior and from
 * the entity's shared `state` bag. The host passes `instance.scratch` each tick,
 * so it persists across ticks deterministically (not module state). Reach for
 * `entity.state` only for data that genuinely crosses the behavior boundary — a
 * value another part reads via an authored `stateKey`/`priorityKey`, or that a
 * game's own code consumes. `scratch` is optional in the signature so a behavior
 * with no private state ignores it; a behavior that uses it is always handed a
 * real object by the host (a standalone/unit invocation must pass one too).
 *
 * @param entity  The entity this behavior is attached to.
 * @param world   The shared world API (entities, input, events, audio, storage, config).
 * @param params  The `$cfg`-resolved params for THIS behavior instance.
 * @param dt      Fixed timestep delta in seconds.
 * @param scratch This behavior INSTANCE's private per-tick-persistent store.
 */
export type BehaviorFn = (
  entity: Entity,
  world: World,
  params: ResolvedParams,
  dt: number,
  scratch?: Record<string, unknown>,
) => void;

/**
 * THE SYSTEM CONTRACT — frozen.
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
