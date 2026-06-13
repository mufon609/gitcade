import type { Config, ConfigLeaf } from "../schema/config.js";
import { isCfgRef, cfgRefPath, resolveConfigPath } from "../schema/config.js";
import type { EntityDef } from "../schema/entity.js";
import { Entity } from "./entity.js";
import { Registry } from "./registry.js";
import { EventBus } from "./eventbus.js";
import { Input } from "./input.js";
import { AudioPlayer } from "./audio.js";
import { MemoryStorage, type StorageAdapter } from "../storage/adapters.js";
import { buildEntity } from "./entity-factory.js";

export interface WorldOptions {
  bounds: { width: number; height: number };
  config: Config;
  registry: Registry;
  input?: Input;
  audio?: AudioPlayer;
  storage?: StorageAdapter;
  /** Deterministic RNG hook (defaults to `Math.random`). */
  rng?: () => number;
}

/**
 * The shared world: the second argument of every {@link BehaviorFn}/{@link SystemFn}
 * and the runtime's single source of truth. Holds the entity set, resolved
 * config, game-wide `state`, and the input/audio/storage/event services. Its
 * public surface is the API behaviors compose against — stable across the SDK's
 * life (extended only additively).
 */
export class World {
  readonly bounds: { width: number; height: number };
  readonly config: Config;
  readonly registry: Registry;
  readonly input: Input;
  readonly audio: AudioPlayer;
  readonly storage: StorageAdapter;
  readonly events = new EventBus();
  readonly rng: () => number;

  /** Game-wide mutable state (scores, flags, level index). Distinct from per-entity state. */
  readonly state: Record<string, unknown> = {};

  /** Live entities. */
  entities: Entity[] = [];

  /** Elapsed simulated time (s) and last fixed delta (s). */
  time = 0;
  dt = 0;
  /** Fixed-update frame counter. */
  frame = 0;

  private byIdIndex = new Map<string, Entity>();
  private spawnedThisTick = false;

  constructor(opts: WorldOptions) {
    this.bounds = opts.bounds;
    this.config = opts.config;
    this.registry = opts.registry;
    this.input = opts.input ?? new Input();
    this.audio = opts.audio ?? new AudioPlayer();
    this.storage = opts.storage ?? new MemoryStorage();
    this.rng = opts.rng ?? Math.random;
    this.input.setWorldSize(opts.bounds.width, opts.bounds.height);
  }

  /** Add an already-built entity to the world. */
  add(entity: Entity): Entity {
    this.entities.push(entity);
    this.byIdIndex.set(entity.id, entity);
    this.spawnedThisTick = true;
    return entity;
  }

  /** Spawn a new entity from a definition at runtime (e.g. bullets, enemies). */
  spawn(def: EntityDef): Entity {
    return this.add(buildEntity(def, this.registry, this.config));
  }

  /** Mark an entity destroyed; it is pruned at the end of the current tick. */
  destroy(entity: Entity): void {
    entity.alive = false;
  }

  /** Entity by id (only live entities). */
  byId(id: string): Entity | undefined {
    const e = this.byIdIndex.get(id);
    return e && e.alive ? e : undefined;
  }

  /** All live entities carrying `tag`. */
  query(tag: string): Entity[] {
    return this.entities.filter((e) => e.alive && e.hasTag(tag));
  }

  /** The live entity with `tag` nearest to `from` (by center distance), if any. */
  nearest(from: Entity, tag: string): Entity | undefined {
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const e of this.entities) {
      if (!e.alive || e === from || !e.hasTag(tag)) continue;
      const dx = e.cx - from.cx;
      const dy = e.cy - from.cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * Resolve a config value by `$cfg.<path>` reference OR a bare dotted path.
   * Returns `undefined` if unresolved.
   */
  cfg(pathOrRef: string): ConfigLeaf | undefined {
    const path = isCfgRef(pathOrRef) ? cfgRefPath(pathOrRef) : pathOrRef;
    return resolveConfigPath(this.config, path);
  }

  /** Prune destroyed entities and refresh the id index. Called at tick end. */
  prune(): void {
    if (!this.spawnedThisTick && this.entities.every((e) => e.alive)) return;
    this.entities = this.entities.filter((e) => e.alive);
    this.byIdIndex.clear();
    for (const e of this.entities) this.byIdIndex.set(e.id, e);
    this.spawnedThisTick = false;
  }
}
