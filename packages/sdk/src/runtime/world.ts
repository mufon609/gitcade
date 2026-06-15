import type { Config, ConfigLeaf } from "../schema/config.js";
import { isCfgRef, cfgRefPath, resolveConfigPath } from "../schema/config.js";
import type { EntityDef } from "../schema/entity.js";
import type { Tilemap } from "../schema/scene.js";
import type { PersistConfig } from "../schema/manifest.js";
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
  /** Cross-run persistence binding (from `manifest.persist`); consumed by the `persistence` system. */
  persist?: PersistConfig;
}

/**
 * A QUEUED scene transition requested from inside a behavior/system via
 * {@link World.requestScene}. Applied by the host loop BETWEEN ticks (never
 * mid-tick), so the frozen in-tick order is preserved (G1).
 */
export interface SceneChangeRequest {
  /** Target scene id (must exist). */
  to: string;
  /** Extra `world.state` keys to carry across this hop (on top of the leaving scene's `flow.persist`). */
  keep?: string[];
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

  /**
   * The parsed tilemap of the ACTIVE scene, or undefined when the scene has none
   * (G3). Set by `Game.loadScene`; READ-ONLY to parts — query it via
   * {@link tileAt}/{@link isBuildable}/{@link cellRect}, don't reassign it.
   */
  tilemap?: Tilemap;

  /** Cross-run persistence binding from `manifest.persist`, read by the `persistence` system (G6). */
  readonly persist?: PersistConfig;

  /** Game-wide mutable state (scores, flags, level index). Distinct from per-entity state. */
  readonly state: Record<string, unknown> = {};

  /** Live entities. */
  entities: Entity[] = [];

  /** Pending scene change, drained by the host loop AFTER the current tick. null = none (G1). */
  private _pendingScene: SceneChangeRequest | null = null;

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
    this.persist = opts.persist;
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
   * Topmost LIVE entity whose AABB contains world point `(x, y)`; optional `tag`
   * filter. Highest `layer` wins, then highest `zIndex` (matching the renderer's
   * draw order, so "what you click is what's on top"). G2 pick primitive — used by
   * menus, tower placement, and the `tap-emit` part instead of hand-rolled hit loops.
   */
  entityAt(x: number, y: number, tag?: string): Entity | undefined {
    let best: Entity | undefined;
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (tag && !e.hasTag(tag)) continue;
      if (x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) {
        if (!best || e.layer > best.layer || (e.layer === best.layer && e.zIndex >= best.zIndex)) best = e;
      }
    }
    return best;
  }

  /** Alias spelling used in the audit; returns the same topmost entity as {@link entityAt}. */
  pick(x: number, y: number, tag?: string): Entity | undefined {
    return this.entityAt(x, y, tag);
  }

  /** Tile index at world `(x, y)`, or `-1` if out of bounds / no tilemap (G3). */
  tileAt(x: number, y: number): number {
    const t = this.tilemap;
    if (!t) return -1;
    const col = Math.floor(x / t.tileSize);
    const row = Math.floor(y / t.tileSize);
    if (col < 0 || row < 0 || col >= t.cols || row >= t.rows) return -1;
    return t.tiles[row * t.cols + col] ?? -1;
  }

  /**
   * Is the tile at world `(x, y)` flagged buildable? No tilemap ⇒ `true`
   * (undecorated scenes stay permissive). Out of bounds / empty tile ⇒ `false`.
   * A decorated tile with no explicit `buildable` flag defaults to `true` (G3).
   */
  isBuildable(x: number, y: number): boolean {
    const t = this.tilemap;
    if (!t) return true;
    const idx = this.tileAt(x, y);
    if (idx < 0) return false;
    return t.properties?.[String(idx)]?.buildable ?? true;
  }

  /** World-space rect `{ x, y, w, h }` of grid cell `(col, row)` (G3). */
  cellRect(col: number, row: number): { x: number; y: number; w: number; h: number } {
    const s = this.tilemap?.tileSize ?? 0;
    return { x: col * s, y: row * s, w: s, h: s };
  }

  /**
   * Request a scene transition from inside a behavior/system. The change is QUEUED
   * and applied by the host loop BETWEEN ticks (never mid-tick), so the frozen
   * in-tick order is preserved. Last request in a tick wins (G1).
   * @param to        target scene id (must exist)
   * @param opts.keep extra `world.state` keys to preserve for this hop
   */
  requestScene(to: string, opts?: { keep?: string[] }): void {
    this._pendingScene = { to, keep: opts?.keep };
  }

  /** Host-only: read & clear the pending scene request. Not part of the part-facing surface (G1). */
  takePendingScene(): SceneChangeRequest | null {
    const r = this._pendingScene;
    this._pendingScene = null;
    return r;
  }

  /** True if `world.state[key]` (a numeric balance) is at least `cost` (G5 assist). */
  canAfford(key: string, cost: number): boolean {
    return ((this.state[key] as number) ?? 0) >= cost;
  }

  /**
   * Deduct `cost` from the numeric balance at `world.state[key]` if affordable.
   * Returns `true` and writes the new balance on success, `false` (no change)
   * otherwise. The thin SDK assist the library `transaction` system wraps (G5).
   */
  spend(key: string, cost: number): boolean {
    const bal = (this.state[key] as number) ?? 0;
    if (bal < cost) return false;
    this.state[key] = bal - cost;
    return true;
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
