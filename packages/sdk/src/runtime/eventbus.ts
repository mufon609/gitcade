/** A game event. `type` is a free-form channel name; `data` is the payload. */
export interface GameEvent<T = unknown> {
  type: string;
  data: T;
}

type Listener = (data: unknown) => void;

/**
 * A tiny synchronous event bus for cross-behavior/system signalling (score,
 * spawn, death, win). Listeners fire immediately on `emit`. Used for game-logic
 * events; per-tick physical collisions are delivered via `entity.collisions`
 * instead (cheaper, no allocation per pair).
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  /** Events emitted this tick, for systems that prefer to drain a queue. */
  private queue: GameEvent[] = [];
  /**
   * Unsubscribers for SCENE-SCOPED listeners registered via {@link onScene}, torn
   * down on every scene transition by {@link clearSceneListeners} (E10). Distinct
   * from a game-lifetime {@link on} listener, which is never auto-removed.
   */
  private sceneUnsubs: Array<() => void> = [];

  on(type: string, listener: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  }

  /**
   * Register a SCENE-SCOPED listener (0.5.0, E10): identical to {@link on}, but the
   * subscription is auto-removed on the next scene transition (`Game.loadScene` calls
   * {@link clearSceneListeners}, right next to its flow-edge teardown). This is the
   * engine generalization of the per-part "attach once per World" `WeakMap` dedup that
   * every event-driven system used to hand-roll: because the bus is wiped on a scene
   * change, a system that (re-)attaches its listener once per scene ENTRY — guarded by
   * a scene-scoped `world.state` flag, the same seed-once idiom parts already use — can
   * never double-fire on "Play again". Returns the same manual unsubscribe as
   * {@link on}; calling it before the transition is safe ({@link clearSceneListeners}
   * then just re-removes an already-gone listener). {@link on} is unchanged — flow
   * edges and host glue that must outlive a scene still use it.
   */
  onScene(type: string, listener: Listener): () => void {
    const off = this.on(type, listener);
    this.sceneUnsubs.push(off);
    return off;
  }

  emit<T = unknown>(type: string, data?: T): void {
    this.queue.push({ type, data });
    const set = this.listeners.get(type);
    if (set) for (const l of [...set]) l(data);
  }

  /** Drain and return events emitted since the last drain. */
  drain(): GameEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  clear(): void {
    this.queue = [];
  }

  /**
   * Host-only: remove every {@link onScene} listener (0.5.0, E10). Called by
   * `Game.loadScene` on each scene transition (next to the flow-edge teardown), so a
   * scene-scoped listener never outlives its scene. Game-lifetime {@link on} listeners
   * (including the host-installed flow edges) are untouched, as is the event {@link queue}
   * (that's {@link clear}'s job). No-op when nothing scene-scoped is registered.
   */
  clearSceneListeners(): void {
    for (const off of this.sceneUnsubs) off();
    this.sceneUnsubs = [];
  }
}
