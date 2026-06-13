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

  on(type: string, listener: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
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
}
