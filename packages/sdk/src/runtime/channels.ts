import type { World } from "./world.js";

/**
 * A typed, named event CHANNEL — a thin compile-time-safe facade over the string-keyed
 * {@link EventBus}. `defineChannel<T>(name)` binds a channel NAME to its payload TYPE once, so an
 * emitter and a listener share ONE declaration instead of re-typing a magic string and hand-casting
 * `unknown` on every call. It is purely ADDITIVE: the facade just forwards to
 * `world.events.{emit,on,onScene}` verbatim — same synchronous fan-out, same queue, same ordering —
 * so a value emitted through a channel is byte-identical to one emitted with a raw string, and the
 * event queue is NOT part of {@link snapshotWorld}, so adopting channels never touches determinism.
 *
 * The namespace stays OPEN: a game with its own one-off signal still calls `world.events.emit(name)`
 * directly (or declares its own `defineChannel` locally). Channels exist to give the WELL-KNOWN
 * engine/library signals a single checkable name + payload — they do not close the namespace, and
 * nothing forces a part to use one.
 */
export interface Channel<T> {
  /** The wire name on the underlying {@link EventBus} (what a raw `emit`/`on`/`flow.on` key uses). */
  readonly name: string;
  /** Emit `payload` on this channel (forwards to `world.events.emit(name, payload)`). */
  emit(world: World, payload: T): void;
  /** Subscribe for the game lifetime (forwards to {@link EventBus.on}); returns the unsubscribe. */
  on(world: World, listener: (payload: T) => void): () => void;
  /** Subscribe for the active SCENE (forwards to {@link EventBus.onScene}); auto-removed on scene change. */
  onScene(world: World, listener: (payload: T) => void): () => void;
}

/**
 * Declare a typed channel: bind a wire `name` to its payload type `T`. The returned {@link Channel}
 * is a stateless, frozen forwarder over {@link EventBus} — the only state lives in the bus, so the
 * same constant can be shared across every part that emits or listens on that name. `T` defaults to
 * `void` for a payload-less ping (`emit(world, undefined)`).
 *
 * The cast at the boundary (`listener as (data: unknown) => void`) is the ONE place the `unknown`
 * payload is narrowed: a caller of `channel.on` gets `T`, while the bus stays untyped underneath, so
 * the open namespace and the typed facade coexist with no change to the bus.
 */
export function defineChannel<T = void>(name: string): Channel<T> {
  return Object.freeze({
    name,
    emit: (world: World, payload: T): void => world.events.emit(name, payload),
    on: (world: World, listener: (payload: T) => void): (() => void) =>
      world.events.on(name, listener as (data: unknown) => void),
    onScene: (world: World, listener: (payload: T) => void): (() => void) =>
      world.events.onScene(name, listener as (data: unknown) => void),
  });
}

// ---------------------------------------------------------------------------
// Engine channels — the well-known signals the SDK runtime itself emits (and that
// the library re-emits or a host listens for). Declared HERE, in the SDK, because
// several are emitted from BOTH packages (e.g. `gameover` from the SDK
// `win-condition` AND three library systems), so the canonical name + payload must
// live where both can import it. Library-only channels live in `@gitcade/library`'s
// own `channels.ts`, which imports {@link defineChannel} and {@link GAME_OVER} from here.
// ---------------------------------------------------------------------------

/**
 * End of game. The ONE canonical payload for a previously-fragmented channel: it was emitted with
 * FOUR incompatible shapes ({@link winCondition} `{winner}`, library `lives-respawn` `{outcome}`,
 * `timer-countdown` `{outcome}`, `win-lose-conditions` `{outcome,winner,by}`). `outcome` is always
 * present; `winner`/`by` are filled when the emitter knows them. A flow edge keyed on `"gameover"`
 * ignores the payload (it only triggers a scene transition), so this canonicalization is safe for
 * every in-repo game; the typed payload is what makes a FUTURE listener able to read it reliably.
 */
export type GameOverPayload = {
  /** Did the player win or lose. */
  outcome: "win" | "lose";
  /** Optional winner label (mirrors `world.state.winner`). */
  winner?: string;
  /** Optional cause label — the condition key/tag that ended it (`win-lose-conditions`). */
  by?: string;
};
export const GAME_OVER: Channel<GameOverPayload> = defineChannel<GameOverPayload>("gameover");

/** The manual pause toggled (engine-owned, emitted by {@link Game.togglePause}). */
export type PauseChangedPayload = { paused: boolean };
export const PAUSE_CHANGED: Channel<PauseChangedPayload> = defineChannel<PauseChangedPayload>("pause-changed");

/** The last level of a `manifest.levels` sequence was cleared with no `levelsComplete` target set. */
export type LevelsCompletePayload = { levels: number };
export const LEVELS_COMPLETE: Channel<LevelsCompletePayload> = defineChannel<LevelsCompletePayload>("levels-complete");

/** An async persistence load finished restoring its keys (see {@link World.resolvePersistKeys}). */
export type PersistRestoredPayload = { keys: string[] };
export const PERSIST_RESTORED: Channel<PersistRestoredPayload> = defineChannel<PersistRestoredPayload>("persist-restored");

/** A point was scored when an entity left the field through a `score-zone` edge (the SDK scoring behavior). */
export type ScorePayload = { scoreKey: string; edge: "left" | "right" | "top" | "bottom" };
export const SCORE: Channel<ScorePayload> = defineChannel<ScorePayload>("score");

/**
 * Names of the engine channels declared above — the single source of truth the validator's
 * `flow-event-never-emitted` advisory consults so a `flow.on` key naming one of these
 * unconditionally-emitted engine signals is never mis-flagged as a dead edge.
 */
export const ENGINE_CHANNEL_NAMES: readonly string[] = [
  GAME_OVER.name,
  PAUSE_CHANGED.name,
  LEVELS_COMPLETE.name,
  PERSIST_RESTORED.name,
  SCORE.name,
];
