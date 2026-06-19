import type { Config, ConfigLeaf } from "../schema/config.js";
import { isCfgRef, cfgRefPath, resolveConfigPath } from "../schema/config.js";
import type { EntityDef } from "../schema/entity.js";
import type { Tilemap } from "../schema/scene.js";
import type { PersistConfig } from "../schema/manifest.js";
import { Entity } from "./entity.js";
import type { SolidRect, SlopeCell, MovingBody } from "./collision.js";
import { resolveSolids, resolveSlopes, applyContacts } from "./collision.js";
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
 * The render VIEWPORT onto the world (0.7.0). `x`/`y` is the top-left of the
 * viewport in WORLD coordinates; `width`/`height` is its size in world px (the
 * canvas/logical size). The renderer translates by `-x`/`-y` before drawing the
 * world, so the viewport is a window that can pan across a `world.bounds` larger
 * than itself. A `camera-follow` system moves `x`/`y`; the default (full bounds at
 * the origin) means a scene with no camera renders byte-identically.
 */
export interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Transient render-only OFFSET added to `x`/`y` by the renderer (0.7.0 camera juice) —
   * the home for screenshake and the like. Kept SEPARATE from `x`/`y` so a `camera-shake`
   * system can jitter the view without corrupting a `camera-follow` base or the
   * pointer→world mapping; both default to 0 (absent ⇒ no offset, byte-identical).
   */
  shakeX?: number;
  shakeY?: number;
  /**
   * Camera position at the START of the current tick (1.8.0 render interpolation) — the camera's
   * `body.prevX`/`prevY` analogue, snapshotted by the host loop before systems run so the renderer can
   * lerp the scroll base between the last two ticks (smooth scrolling when rAF ≠ the fixed sim rate).
   * Render-only and DECOUPLED from `x`/`y`: the simulation never reads it, so headless play is
   * byte-identical. Absent ⇒ the renderer falls back to `x`/`y` (no interpolation, e.g. tick 1).
   */
  prevX?: number;
  prevY?: number;
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
  /**
   * WORLD/simulation bounds in px (the playable area). Behaviors clamp/floor/bounce
   * against this. DECOUPLED from the {@link camera} viewport since 0.7.0: a scrolling
   * level sets `bounds` LARGER than the viewport. The host (`Game`) updates these per
   * scene from `scene.world ?? scene.size`; parts read them, don't reassign them.
   */
  readonly bounds: { width: number; height: number };
  /**
   * The render viewport onto the world (0.7.0). Defaults to the full bounds at the
   * origin (so a camera-less scene renders byte-identically); a `camera-follow`
   * system pans it and the renderer reads it. The host sizes `width`/`height` to the
   * viewport (`scene.size`).
   */
  camera: Camera;
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

  /**
   * Keys CLAIMED by a persistence load that is still in flight (0.2.1, G6 race
   * fix). While a key is claimed, a seed-once system (e.g. `currency`) defers
   * seeding it, so the async `storage.get` restore lands as the authoritative
   * boot value instead of being clobbered by a synchronous tick-1 seed. The set
   * is scene-scoped: `loadScene` clears it, since the active scene owns its
   * persistence/seed systems. See {@link claimPersistKeys}.
   */
  private _persistPending = new Set<string>();

  /**
   * Keys whose persistence load has COMPLETED this scene — i.e. the restore wrote
   * any saved value and released the claim (0.3.1, IC-9). Distinct from the pending
   * set: a key moves pending → restored when {@link resolvePersistKeys} runs. Scene-
   * scoped (reset by {@link resetPersistTracking} on every transition). Lets a host
   * await the restore deterministically via {@link whenRestored} instead of polling
   * {@link isPersistPending} and racing it.
   */
  private _persistRestored = new Set<string>();

  /** Hosts awaiting a restore via {@link whenRestored}; each resolves when all its keys are restored. */
  private _restoreWaiters: Array<{ keys: string[]; resolve: () => void }> = [];

  /** Elapsed simulated time (s) and last fixed delta (s). */
  time = 0;
  dt = 0;
  /** Fixed-update frame counter. */
  frame = 0;

  private byIdIndex = new Map<string, Entity>();
  private spawnedThisTick = false;

  constructor(opts: WorldOptions) {
    this.bounds = opts.bounds;
    // Default the viewport to the whole world at the origin — the host overrides
    // width/height with the actual viewport (`scene.size`) when it differs (0.7.0).
    this.camera = { x: 0, y: 0, width: opts.bounds.width, height: opts.bounds.height };
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
   * Claim `keys` as pending-restore for an in-flight persistence load (0.2.1,
   * G6 race fix). Idempotent. A persistence system calls this SYNCHRONOUSLY on
   * its first tick — before any seed-once system runs that frame — so a
   * seed-once system can ask {@link isPersistPending} and DEFER seeding the key.
   * When the async `storage.get` resolves, the persistence system restores the
   * saved values and calls {@link resolvePersistKeys} to release the claim
   * (keys with no saved value are simply released, so the seed system seeds them
   * on the next tick). Purely additive: a system that does not consult the claim
   * keeps its 0.2.0 behavior exactly. The claim set is reset by `loadScene`.
   */
  claimPersistKeys(keys: Iterable<string>): void {
    for (const k of keys) this._persistPending.add(k);
  }

  /** True if `key` is claimed by an unresolved persistence load (0.2.1, G6). */
  isPersistPending(key: string): boolean {
    return this._persistPending.has(key);
  }

  /** Snapshot of the currently-claimed keys (0.2.1, G6) — host uses it to reset on scene change. */
  persistPendingKeys(): string[] {
    return [...this._persistPending];
  }

  /**
   * Release the persistence claim on `keys` (0.2.1, G6) — called by the
   * persistence system once its async load resolves (after writing any restored
   * values). Released keys are eligible for normal seeding again.
   *
   * Restore-complete signal (0.3.1, IC-9): each released key is also recorded as
   * restored, a `"persist-restored"` event fires with `{ keys }`, and any
   * {@link whenRestored} waiter whose keys are now all restored resolves. This is
   * the deterministic "the saved state has landed" signal — purely additive (a
   * caller that ignores the event/promise sees the exact 0.2.1 release behavior),
   * and it does NOT touch the frozen storage-bridge wire protocol: the persistence
   * system already calls this in its load `.finally`.
   */
  resolvePersistKeys(keys: Iterable<string>): void {
    const released: string[] = [];
    for (const k of keys) {
      this._persistPending.delete(k);
      this._persistRestored.add(k);
      released.push(k);
    }
    if (released.length === 0) return;
    this.events.emit("persist-restored", { keys: released });
    this._restoreWaiters = this._restoreWaiters.filter((w) => {
      if (w.keys.every((k) => this._persistRestored.has(k))) {
        w.resolve();
        return false;
      }
      return true;
    });
  }

  /**
   * Resolve once every key in `keys` has been restored this scene (0.3.1, IC-9) —
   * the race-free alternative to polling {@link isPersistPending}. Resolves
   * immediately if the restore already completed; otherwise resolves when
   * {@link resolvePersistKeys} releases the last awaited key. A host reads the
   * authoritative persisted value AFTER this resolves, instead of guessing when
   * the async `storage.get` has landed (the root enabler of idle-clicker's
   * offline-credit race). Scene-scoped: a pending wait is resolved by
   * {@link resetPersistTracking} on a scene change so it can never hang.
   */
  whenRestored(keys: Iterable<string>): Promise<void> {
    const arr = [...keys];
    if (arr.every((k) => this._persistRestored.has(k))) return Promise.resolve();
    return new Promise<void>((resolve) => this._restoreWaiters.push({ keys: arr, resolve }));
  }

  /**
   * Reset all persistence-restore tracking — the pending claims, the restored set,
   * and any outstanding {@link whenRestored} waiters (0.3.1, IC-9). Called by
   * `Game.loadScene` on every transition: the restore set is scene-scoped (the new
   * scene owns its own persistence/seed systems), and resolving leftover waiters
   * keeps a stale promise from the old scene from hanging forever. Replaces the
   * old `resolvePersistKeys(persistPendingKeys())` cleanup so a scene change does
   * NOT masquerade as a restore-complete signal.
   */
  resetPersistTracking(): void {
    this._persistPending.clear();
    this._persistRestored.clear();
    for (const w of this._restoreWaiters) w.resolve();
    this._restoreWaiters = [];
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

  /**
   * Resolve the entity HIERARCHY (0.9.0 scene graph): for every entity with a
   * {@link Entity.parentId}, derive its WORLD transform from the parent's world transform
   * composed with its {@link Entity.local} offset (carried items, riders, multi-part bodies,
   * attached HUD/FX). The host runs this as a tick PHASE AFTER behaviors + prune, so a child
   * reads its parent's settled position this tick. Resolution is parent-FIRST (a turret on a
   * platform on a lift resolves the lift, then the platform, then the turret), deterministic
   * (entities walked in array order, parents pulled in on demand via {@link byId}), and
   * cycle-safe (a cycle member is treated as a root — its world transform left as-is); a
   * missing/dead parent leaves the child at its last world transform (orphan in place).
   *
   * FAST PATH: with no parented entity this returns before any allocation, so a scene with no
   * parenting is byte-identical to a flat world — the whole frozen-safety guarantee. NOTE the
   * child's world `x`/`y` are written here, AFTER this tick's collision detection ran, so a
   * parented child's collision/pick box is ONE TICK stale — the same idiom `solid-collide`
   * tolerates when riding a lift. Parenting controls the TRANSFORM, not draw order (z is still
   * `layer`/`zIndex`).
   */
  resolveHierarchy(): void {
    let hasParent = false;
    for (const e of this.entities) {
      if (e.parentId !== undefined) {
        hasParent = true;
        break;
      }
    }
    if (!hasParent) return;

    const resolved = new Set<Entity>();
    const visiting = new Set<Entity>();
    const resolve = (e: Entity): void => {
      if (resolved.has(e)) return;
      const pid = e.parentId;
      if (pid === undefined) {
        resolved.add(e); // root: its world transform is authoritative
        return;
      }
      if (visiting.has(e)) {
        resolved.add(e); // cycle (incl. self-parent): treat as a root, leave world as-is
        return;
      }
      const parent = this.byId(pid);
      if (!parent) {
        resolved.add(e); // missing/dead parent: orphan in place at its last world transform
        return;
      }
      visiting.add(e);
      resolve(parent); // ensure the parent's world transform is final BEFORE composing
      visiting.delete(e);
      // If resolving the parent walked a cycle back through this entity, it was already marked
      // a root (its world transform left as-is) — don't then compose it against the cycle.
      if (resolved.has(e)) return;
      // world = parentTranslate · parentRotate · parentScale · local (standard 2D TRS), about
      // the parent's top-left origin. Per-axis parent scale FIRST (so a flipped parent, scaleX<0,
      // mirrors the child's offset + facing), then rotate by the parent's rotation, then translate.
      const l = e.local;
      const cosP = Math.cos(parent.rotation);
      const sinP = Math.sin(parent.rotation);
      const lx = l.x * parent.scaleX;
      const ly = l.y * parent.scaleY;
      e.x = parent.x + (lx * cosP - ly * sinP);
      e.y = parent.y + (lx * sinP + ly * cosP);
      e.rotation = parent.rotation + l.rotation;
      e.scaleX = parent.scaleX * l.scale;
      e.scaleY = parent.scaleY * l.scale;
      resolved.add(e);
    };
    for (const e of this.entities) resolve(e);
  }

  /**
   * The unified collision-resolution PHASE (1.1.0): resolve every DYNAMIC collider against the solid
   * world — solid tiles AND solid-role entity colliders — in one owned pass. The single, typed
   * replacement for the order-sensitive `tilemap-collide` + `solid-collide` resolver behaviors:
   * solidity is declared once (the `collider` component, see {@link ColliderComponent}) and resolved
   * in exactly one place.
   *
   * The host runs this as a tick phase AFTER behaviors + prune, BEFORE {@link resolveHierarchy} —
   * appended like the 0.9.0 hierarchy phase, NOT a reorder of the frozen systems→behaviors→prune
   * sequence. Resolving after the whole behavior pass means every body is at its settled intended
   * position (a moving solid has already moved this tick), so a dynamic resolves against final
   * geometry with no author-ordering rule. A mover reading `entity.body.contacts` reads last tick's
   * contacts — the documented, coyote-covered one-tick-stale read, unchanged.
   *
   * FAST PATH: with no collider anywhere this returns before any allocation, so an arcade scene is
   * byte-identical to a flat world — the frozen-safety guarantee, exactly like `resolveHierarchy`.
   *
   * Per dynamic body (resolved in entity-array order — the deterministic tie-break; the coupled
   * dynamic-on-dynamic ordering for push arrives with a later increment):
   *  1. Carry: if the body rested on a `carriable` solid at tick start and isn't rising, inherit that
   *     carrier's this-tick displacement (horizontal always; descending too — vertical-UP carry comes
   *     free from the push-out's re-grounding below) BEFORE the push-out. Applying it first (not after,
   *     then re-resolving) avoids a double-count, since the push-out already follows a moving platform
   *     vertically. A carrier is a solid already moved by its own behaviors this tick, so its
   *     displacement is final — no author-ordering rule, no one-tick lag (what the retired
   *     `ride-platform` needed manually).
   *  2. Broadphase the body's SWEPT box this tick into the solids it could touch — solid tiles in
   *     the bounded cell range, plus solid-role entities whose AABB overlaps the swept box. The
   *     entity set is CANDIDATE-KEYED (a far solid is excluded), so a body's sub-stepping depends
   *     only on nearby geometry, not the global solid set — a far decorative solid can no longer
   *     perturb its physics (a deliberate determinism improvement over the per-behavior resolvers,
   *     which fed the whole tagged set; gated by the proofs + the candidate-keyed fuzz harness).
   *  3. Push-out in two passes: the shared {@link resolveSolids} primitive against the solid boxes
   *     (swept, so a fast body can't tunnel a thin solid), then {@link resolveSlopes} against any
   *     floor-slope tiles under the body (resting its bottom on the per-column ramp surface). Both
   *     write `entity.body.contacts` via {@link applyContacts}, merged within the tick by frame stamp.
   *     Running after the carry settles a carried rider precisely AND corrects it against walls the
   *     same tick — the re-resolution a naive post-behavior carry phase lacks.
   *
   * Then, once every dynamic has settled against the static world, a final PUSH pass ({@link resolvePush})
   * resolves dynamic-vs-`pushable`-dynamic SIDE contacts (a pusher shoves a crate; crates chain and stop
   * against walls). It is skipped entirely — byte-identical — when no entity is `pushable`.
   *
   * `oneWay` solids (top-face-only tiles via the `oneWay` tile prop, or `oneWay` colliders) are
   * dropped while the mover's drop-through window is open (`body.dropThrough > 0`). A non-zero
   * collider `inset` resolves a box shrunk in from the sprite AABB, mapped back onto the entity.
   */
  resolveBodies(): void {
    // Fast path: no collider anywhere ⇒ no-op (byte-identical arcade scene).
    let hasCollider = false;
    for (const e of this.entities) {
      if (e.alive && e.body.collider) {
        hasCollider = true;
        break;
      }
    }
    if (!hasCollider) return;

    // The immovable blockers this tick: every solid-role collider (solids move via their own
    // behaviors, never resolved here) — plus the CARRIABLE subset (moving platforms that carry
    // riders). DYNAMIC bodies (resolved + pushed) are gathered too, for the push pass.
    const solids: Entity[] = [];
    const carriables: Entity[] = [];
    const dynamics: Entity[] = [];
    let anyPushable = false;
    for (const e of this.entities) {
      const c = e.body.collider;
      if (!e.alive || !c) continue;
      if (c.role === "solid") {
        solids.push(e);
        if (c.carriable) carriables.push(e);
      } else {
        dynamics.push(e);
        if (c.pushable) anyPushable = true;
      }
    }

    for (const e of dynamics) {
      const c = e.body.collider!;

      // The collider box = the sprite AABB shrunk by the optional inset, carrying this tick's
      // velocity. With no inset the entity IS the MovingBody (zero-alloc, like the old resolvers).
      const ix = c.inset.x;
      const iy = c.inset.y;
      const hasInset = ix !== 0 || iy !== 0;
      const body: MovingBody = hasInset
        ? { x: e.x + ix, y: e.y + iy, w: e.w - 2 * ix, h: e.h - 2 * iy, vx: e.vx, vy: e.vy }
        : e;
      const dropping = e.body.dropThrough > 0;

      // Step 1 — CARRY: a rider that rested on a carriable solid at tick start (and isn't rising)
      // inherits the carrier's this-tick displacement FIRST. Applying it BEFORE the push-out (rather
      // than after, then re-resolving) is what avoids a double-count: the push-out's own re-grounding
      // already follows a moving platform vertically, so adding the descent again after it would sink
      // the rider by one tick's displacement. A carrier is a solid already moved by its own behaviors
      // this tick, so its displacement is final — no author-ordering rule and no one-tick lag (the
      // manual "ride-platform first" the retired behavior needed).
      if (carriables.length > 0 && body.vy >= 0) {
        const carrier = findCarrier(e, ix, iy, carriables);
        if (carrier) {
          body.x += carrier.x - carrier.body.prevX; // horizontal carry (always)
          const dy = carrier.y - carrier.body.prevY;
          if (dy > 0) body.y += dy; // descending carry only — ascending is the push-out's job
        }
      }

      // Step 2 — push the body out of the solid world (solids + slopes), writing contacts. Running it
      // AFTER the carry settles a carried rider precisely on the (already-moved) carrier and corrects
      // it against walls/floor the SAME tick — the same-tick re-resolution a naive carry phase lacks.
      this.resolveColliderAgainstWorld(e, body, solids, dropping);

      // Map the resolved collider box back onto the entity (no-op without an inset; every pass ran
      // on `body`, so this captures the solid push-out, the slope snap, AND the carry.)
      if (hasInset) {
        e.x = body.x - ix;
        e.y = body.y - iy;
        e.vx = body.vx;
        e.vy = body.vy;
      }
    }

    // Step 4 — PUSH: resolve dynamic-vs-`pushable`-dynamic side contacts (a pusher shoves a crate),
    // after every body has settled against the static world. Skipped entirely (byte-identical) when
    // no entity is pushable. See {@link resolvePush}.
    if (anyPushable) this.resolvePush(dynamics, solids);
  }

  /**
   * Step 4 of {@link resolveBodies}: horizontal two-body PUSH. A dynamic that drives into the SIDE of
   * a `pushable` dynamic shoves it along; the crate is limited by the solid world and by other crates
   * (chains), and a pusher stops against a crate it can't move (e.g. one wedged against a wall).
   *
   * Three phases (replay-safe, deterministic; pairs scanned in entity-array order):
   *  - PHASE 1 — each pusher drives each crate it reached this tick flush ahead of it, ONCE, by the
   *    SWEPT shove ({@link sweptShove}, 1.7.0): the pusher's leading-edge overshoot past the crate's near
   *    face, NOT the settled-frame overlap — so a pusher faster than the crate's width per tick transfers
   *    its whole displacement instead of tunnelling (settled overlap ≈ 0) or being yanked backward by
   *    phase 3 (settled overlap under-reads the penetration).
   *  - PHASE 2 — a bounded `PUSH_ITERATIONS` relaxation that settles the crates: (a) separate every
   *    overlapping crate↔crate pair, mass-split by inverse mass (the lighter pushable moves more); (b)
   *    eject each pushable positionally from any solid it was shoved into (the velocity-gated push-out
   *    can't — a shoved crate has no velocity of its own) and mark it BLOCKED; (c) propagate blocked-ness
   *    up a flush chain. A BLOCKED crate is immovable in (a), so a wall constraint climbs the chain — the
   *    crate behind yields fully rather than sinking in, and a pusher driving a chain into a wall stops
   *    flush behind it. If the relaxation runs out of budget with motion pending it warns once ({@link
   *    warnPushNonConvergence}).
   *  - PHASE 3 — hard-clamp any non-pushable pusher still overlapping a crate out of it, so it stops
   *    flush behind a crate it couldn't move.
   *
   * VERTICAL stacking (standing on a crate) is intentionally NOT handled here — a pushable is not
   * solid-to-dynamics.
   */
  private resolvePush(dynamics: Entity[], solids: Entity[]): void {
    // Crates wedged against a solid this tick — immovable for the rest of the push pass, so the wall
    // constraint propagates up a chain instead of the relaxation letting crates sink into each other.
    const blocked = new Set<Entity>();
    const invMass = (e: Entity): number => {
      const c = e.body.collider!;
      return c.pushable && !blocked.has(e) ? 1 / c.mass : 0;
    };

    // A horizontal SIDE contact between two dynamics: the overlap depth `ox` and the direction `dir`
    // (B on A's +dir side, from TICK-START centers — overshoot-safe: a fast pusher can overshoot past
    // a crate's center within a tick, and a current-position test would flip and shove it backward).
    // null ⇒ no overlap, or a shallow vertical/stacking overlap (a rider standing on a crate — a
    // pushable is not solid-to-dynamics, so stacking is left for a later increment).
    const side = (A: Entity, B: Entity): { ox: number; dir: 1 | -1 } | null => {
      const boxA = colliderBox(A);
      const boxB = colliderBox(B);
      const ox = overlapAmt(boxA.x, boxA.w, boxB.x, boxB.w);
      const oy = overlapAmt(boxA.y, boxA.h, boxB.y, boxB.h);
      if (ox <= 0 || oy <= 0 || oy * 2 < Math.min(boxA.h, boxB.h)) return null;
      return { ox, dir: A.body.prevX + A.w / 2 <= B.body.prevX + B.w / 2 ? 1 : -1 };
    };

    // Phase 1 — each pusher (non-pushable dynamic) drives each crate it reached this tick ahead of it,
    // ONCE, by the SWEPT shove (1.7.0). The shove is the pusher's leading-edge OVERSHOOT past the crate's
    // near face — not the settled-frame overlap — so a pusher faster than the crate's width per tick still
    // transfers its WHOLE displacement to the crate instead of tunnelling through it (settled overlap ≈ 0,
    // old code did nothing) or being yanked backward by the phase-3 clamp while the crate barely moved
    // (settled overlap under-read the real penetration). The crate ends flush ahead of the pusher; phase 2
    // then settles it against the world + other crates, and phase 3 clamps the pusher behind a blocked one.
    // (Applied ONCE — re-applying it every iteration would bury a crate in its neighbour.)
    for (let a = 0; a < dynamics.length; a++) {
      for (let b = a + 1; b < dynamics.length; b++) {
        const A = dynamics[a];
        const B = dynamics[b];
        if (A.body.collider!.pushable === B.body.collider!.pushable) continue; // need a pusher + a crate
        const crate = A.body.collider!.pushable ? A : B;
        const pusher = crate === A ? B : A;
        const shove = sweptShove(pusher, crate);
        if (!shove) continue;
        // Clamp the shove so the crate stops FLUSH at the first solid in its path — a pusher can't drive
        // a crate THROUGH a wall. Without this, a deep swept shove could overshoot a crate past a thin
        // solid (one narrower than the crate), where phase-2's min-translation eject would then push it
        // the wrong way (further through) instead of back. Clamped, phase 2 only trims sub-px residue.
        const dist = clampShoveBySolids(crate, shove.dir, shove.dist, this.tilemap, solids);
        if (dist > 0) crate.x += shove.dir * dist; // drive the crate flush ahead of the pusher
      }
    }

    // Phase 2 — settle the crates among themselves + the solid world (bounded relaxation, replay-safe).
    // `pushConverged` flips true the iteration nothing moves; if the fixed budget runs out with motion
    // still pending, the chain under-separated this tick and we warn ONCE (the cap is no longer silent).
    let pushConverged = false;
    for (let iter = 0; iter < PUSH_ITERATIONS; iter++) {
      let moved = false;

      // Separate overlapping crate↔crate side contacts, mass-split (a blocked crate is immovable).
      for (let a = 0; a < dynamics.length; a++) {
        for (let b = a + 1; b < dynamics.length; b++) {
          const A = dynamics[a];
          const B = dynamics[b];
          if (!A.body.collider!.pushable || !B.body.collider!.pushable) continue; // crate↔crate only
          const c = side(A, B);
          if (!c) continue;
          const invA = invMass(A);
          const invB = invMass(B);
          const s = invA + invB;
          if (s <= 0) continue; // both blocked
          A.x -= c.dir * c.ox * (invA / s);
          B.x += c.dir * c.ox * (invB / s);
          moved = true;
        }
      }

      // Eject each pushable from any solid it was shoved into; a crate the eject moved is wedged
      // against that solid ⇒ blocked (immovable) for the rest of the pass.
      for (const C of dynamics) {
        if (C.body.collider!.pushable && ejectFromSolids(C, this.tilemap, solids)) {
          blocked.add(C);
          moved = true;
        }
      }

      // Propagate blocked-ness: a crate now FLUSH against a blocked crate (not still mid-penetration)
      // is itself immovable — so the "can't move" of a wall-wedged crate climbs the chain.
      for (let grew = true; grew; ) {
        grew = false;
        const front = [...blocked];
        for (const C of dynamics) {
          if (!C.body.collider!.pushable || blocked.has(C)) continue;
          const cBox = colliderBox(C);
          for (const K of front) {
            const kBox = colliderBox(K);
            const ox = overlapAmt(cBox.x, cBox.w, kBox.x, kBox.w);
            const oy = overlapAmt(cBox.y, cBox.h, kBox.y, kBox.h);
            if (ox > -0.5 && ox < 0.5 && oy * 2 >= Math.min(cBox.h, kBox.h)) {
              blocked.add(C);
              grew = true;
              break;
            }
          }
        }
      }

      if (!moved) {
        pushConverged = true;
        break;
      }
    }
    if (!pushConverged) warnPushNonConvergence();

    // Phase 3 — clamp each pusher out of any crate it still overlaps, so it stops flush behind the
    // settled crate (the crate is solid to the pusher once it can't move — e.g. wedged against a wall).
    for (let iter = 0; iter < PUSH_ITERATIONS; iter++) {
      let moved = false;
      for (let a = 0; a < dynamics.length; a++) {
        for (let b = a + 1; b < dynamics.length; b++) {
          const A = dynamics[a];
          const B = dynamics[b];
          if (A.body.collider!.pushable === B.body.collider!.pushable) continue; // a pusher + a crate
          const pusher = A.body.collider!.pushable ? B : A;
          const crate = A.body.collider!.pushable ? A : B;
          const c = side(pusher, crate); // dir: crate sits on pusher's +dir side
          if (!c) continue;
          pusher.x -= c.dir * c.ox; // move the pusher away from the crate
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /**
   * Step 2 of {@link resolveBodies} for one dynamic `body` (the collider box of entity `e`): broadphase
   * its swept box into the solid candidates, push it out via {@link resolveSolids}, rest it on any
   * floor slope via {@link resolveSlopes}, and write `e.body.contacts`. Factored out because the carry
   * step re-runs it after applying a carrier's displacement (re-broadphased from the carried position).
   */
  private resolveColliderAgainstWorld(e: Entity, body: MovingBody, solids: Entity[], dropping: boolean): void {
    const t = this.tilemap;
    const dt = this.dt;
    const rects: SolidRect[] = [];
    const slopeCells: SlopeCell[] = [];

    // Broadphase: the body's swept box (pre-move → post-move), padded so a flush-resting solid
    // stays a candidate. resolveSolids itself is precise, so over-inclusion only costs a scan.
    const px = body.x - body.vx * dt;
    const py = body.y - body.vy * dt;
    const loX = Math.min(px, body.x) - BROAD_PAD;
    const hiX = Math.max(px, body.x) + body.w + BROAD_PAD;
    const loY = Math.min(py, body.y) - BROAD_PAD;
    const hiY = Math.max(py, body.y) + body.h + BROAD_PAD;

    if (t) gatherTiles(t, loX, hiX, loY, hiY, dropping, rects, slopeCells);

    for (const s of solids) {
      if (s === e) continue;
      const sc = s.body.collider!;
      if (sc.oneWay && dropping) continue; // dropping through a one-way solid
      // Broadphase + resolve against the solid's COLLIDER box (its `inset` honored), NOT the raw
      // sprite AABB — consistent with {@link ejectFromSolids}/{@link findCarrier}, which both read
      // colliderBox(s). Reading the sprite box here would block a dynamic at a different face than
      // the same solid ejects a pushed crate at / carries a rider on (an inset solid would be
      // bigger to the push-out than to the eject). No-op for the common inset-free solid.
      const sb = colliderBox(s);
      if (sb.x < hiX && sb.x + sb.w > loX && sb.y < hiY && sb.y + sb.h > loY) {
        rects.push(sc.oneWay ? { ...sb, oneWay: true } : sb);
      }
    }

    // Pass 1 — solid AABB push-out (tiles + solid entities), writing the contact flags.
    const contacts = resolveSolids(body, rects, dt);
    applyContacts(e.body, this.frame, contacts);
    // Pass 2 — floor SLOPES: rest the body's bottom on the per-column ramp surface, AFTER the solid
    // pass settled X (a wall at a ramp's base has clamped the sample x). Merges into the same-tick
    // contacts via the frame stamp. Skipped (and so byte-identical) when no slope cell is under it.
    if (slopeCells.length > 0) {
      const slope = resolveSlopes(body, slopeCells, dt);
      if (slope.onGround) {
        applyContacts(e.body, this.frame, { onGround: true, onCeiling: false, onWallL: false, onWallR: false, onOneWay: false });
      }
    }
  }
}

/** Padding (px) on the broadphase swept box, so a solid the body rests flush against stays a candidate. */
const BROAD_PAD = 1;
/** Feet-probe tolerance (px) around a carrier's top for the carry rest-check (matches the retired ride-platform default). */
const CARRY_STICK = 2;

/**
 * The carriable solid that dynamic `e` (collider inset `ix`/`iy`) rested on at TICK START, or null —
 * the carry feet-probe. Uses tick-start collider boxes (`body.prevX`/`prevY`) so it detects "was
 * riding at the start of this tick" regardless of how step 2 has since moved the rider, and so a
 * fast-descending carrier (which step 2 may have left the rider floating above) still keeps its rider.
 * First match wins (entity-array order). The `vy >= 0` not-rising gate is applied by the caller.
 */
function findCarrier(e: Entity, ix: number, iy: number, carriables: Entity[]): Entity | null {
  const riderBottom = e.body.prevY + e.h - iy; // rider collider bottom at tick start
  const riderLeft = e.body.prevX + ix;
  const riderRight = e.body.prevX + e.w - ix;
  for (const carrier of carriables) {
    if (carrier === e) continue;
    const sc = carrier.body.collider!;
    const top = carrier.body.prevY + sc.inset.y; // carrier collider top at tick start
    const left = carrier.body.prevX + sc.inset.x;
    const right = carrier.body.prevX + carrier.w - sc.inset.x;
    if (Math.abs(riderBottom - top) <= CARRY_STICK && riderRight > left && riderLeft < right) return carrier;
  }
  return null;
}

/** Fixed push-relaxation iteration count — replay-safe (deterministic), enough for short crate chains. */
const PUSH_ITERATIONS = 8;

/** Has the push-non-convergence notice already fired this process? (warn-once, so it never spams a loop). */
let pushConvergenceWarned = false;
/**
 * Surface a push relaxation that did NOT settle within {@link PUSH_ITERATIONS} this tick — a long or
 * deeply-overlapping crate chain that under-separated by (typically sub-pixel) amounts. The bounded,
 * fixed-iteration relaxation is replay-deterministic by design, but the cap was SILENT: a chain past
 * the budget would under-resolve with no signal. This makes it loud (once per process, so a per-tick
 * loop can't spam), the developer-facing half of the "no silent cap" fix. Gradual play converges well
 * within 8 iterations; this fires only on pathological simultaneous overlap (e.g. crates spawned
 * interpenetrating, or a single fast pusher driving a long chain in one tick).
 */
function warnPushNonConvergence(): void {
  if (pushConvergenceWarned) return;
  pushConvergenceWarned = true;
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      `[gitcade] resolvePush did not converge within ${PUSH_ITERATIONS} relaxation iterations — a long ` +
        `or deeply-overlapping crate chain under-separated this tick (typically sub-pixel). Reduce ` +
        `simultaneous crate overlap or shorten the chain. (Shown once per process.)`,
    );
  }
}

/** The collider AABB of `e` (sprite box minus its inset). */
function colliderBox(e: Entity): { x: number; y: number; w: number; h: number } {
  const c = e.body.collider!;
  return { x: e.x + c.inset.x, y: e.y + c.inset.y, w: e.w - 2 * c.inset.x, h: e.h - 2 * c.inset.y };
}

/** Overlap depth of two 1-D spans `[aMin,aMin+aLen]` / `[bMin,bMin+bLen]` (>0 ⇒ overlapping). */
function overlapAmt(aMin: number, aLen: number, bMin: number, bLen: number): number {
  return Math.min(aMin + aLen, bMin + bLen) - Math.max(aMin, bMin);
}

/**
 * The SWEPT pusher→crate shove (1.7.0 — phase 1 of {@link World.resolvePush}): how far, and which way,
 * a pusher must drive a `pushable` crate so the pusher ends FLUSH behind it — measured from the pusher's
 * leading edge's full sweep this tick, NOT the settled-frame AABB overlap. This is what makes push
 * non-tunnelling at speed: the swept penetration `pusherLeadingEdge − crateNearFace` stays correct (and
 * positive) even when the pusher's trailing edge ends PAST the crate (a static overlap test reads 0 and
 * the old code did nothing) or when a deep overshoot makes the settled overlap UNDER-read the real
 * penetration (the old code shoved by that small overlap, and phase 3 then yanked the pusher backward).
 *
 * Resolves on COLLIDER boxes (insets honored, like the rest of the phase). Returns `null` when this isn't
 * a side push:
 *  - the two aren't at the same height — no vertical overlap, or only a shallow top/bottom (stand-on)
 *    contact (`oy*2 < minH`), which the push pass leaves alone (a pushable isn't solid-to-dynamics here);
 *  - the pusher hasn't reached the crate (`dist <= 0`).
 * Direction is taken from TICK-START centers (`body.prevX`), overshoot-safe: a fast pusher can end past
 * the crate's center, where a current-position test would flip the sign and shove the crate backward.
 */
function sweptShove(pusher: Entity, crate: Entity): { dir: 1 | -1; dist: number } | null {
  const P = colliderBox(pusher);
  const C = colliderBox(crate);
  const oy = overlapAmt(P.y, P.h, C.y, C.h);
  if (oy <= 0 || oy * 2 < Math.min(P.h, C.h)) return null; // not a same-height side contact
  const dir: 1 | -1 = pusher.body.prevX + pusher.w / 2 <= crate.body.prevX + crate.w / 2 ? 1 : -1;
  // Swept penetration: how far the pusher's LEADING edge is past the crate's NEAR face NOW. >0 ⇒ the
  // pusher reached/overran the crate this tick; the crate moves that far so the pusher ends flush behind it.
  const dist = dir === 1 ? P.x + P.w - C.x : C.x + C.w - P.x;
  return dist > 0 ? { dir, dist } : null;
}

/**
 * The largest prefix of a `dir` shove of `dist` px that keeps crate `C`'s LEADING face at/before the
 * nearest solid in its path — i.e. how far the crate can actually be driven before a wall stops it
 * (1.7.0, the swept-push companion to {@link sweptShove}). A pusher must not drive a crate THROUGH a
 * solid; the swept shove can be large enough to overshoot a crate past a thin solid (one narrower than
 * the crate), where the positional eject's min-translation would resolve it the wrong way. Clamping the
 * shove here keeps the crate flush against the wall instead. Scans solid tiles in the crate's Y-span +
 * swept X-range and solid entities overlapping its Y-span; one-way solids never block a crate sideways.
 */
function clampShoveBySolids(C: Entity, dir: 1 | -1, dist: number, tilemap: Tilemap | undefined, solids: Entity[]): number {
  const box = colliderBox(C);
  const lead = dir === 1 ? box.x + box.w : box.x; // the crate's leading face now
  const loX = Math.min(lead, lead + dir * dist) - BROAD_PAD;
  const hiX = Math.max(lead, lead + dir * dist) + BROAD_PAD;
  let limit = dist;
  const block = (sLeft: number, sRight: number): void => {
    // A solid clamps the shove only if its NEAR face lies ahead of the leading face in `dir`.
    if (dir === 1) {
      if (sLeft >= lead - 0.001) limit = Math.min(limit, Math.max(0, sLeft - lead));
    } else if (sRight <= lead + 0.001) {
      limit = Math.min(limit, Math.max(0, lead - sRight));
    }
  };
  if (tilemap) {
    const rects: SolidRect[] = [];
    const throwaway: SlopeCell[] = [];
    gatherTiles(tilemap, loX, hiX, box.y - BROAD_PAD, box.y + box.h + BROAD_PAD, false, rects, throwaway);
    for (const r of rects) {
      if (r.oneWay) continue; // a pass-through ledge never blocks a crate from the side
      if (r.y < box.y + box.h && r.y + r.h > box.y) block(r.x, r.x + r.w);
    }
  }
  for (const s of solids) {
    if (s.body.collider!.oneWay) continue;
    const sb = colliderBox(s);
    if (sb.y < box.y + box.h && sb.y + sb.h > box.y && sb.x < hiX && sb.x + sb.w > loX) block(sb.x, sb.x + sb.w);
  }
  return limit;
}

/** Tile property flagging a fully-solid cell — the conventional name the phase reads (frozen tile-prop convention). */
const SOLID_TILE_PROP = "solid";
/** Tile property flagging a one-way (top-face-only) platform cell. */
const ONE_WAY_TILE_PROP = "oneWay";
/** Tile properties (px up from the cell bottom) marking a floor-SLOPE cell at its left/right edge. */
const SLOPE_L_PROP = "slopeL";
const SLOPE_R_PROP = "slopeR";

/**
 * Gather the tile cells overlapping `[loX,hiX]×[loY,hiY]` into `rects` (SOLID/one-way push-out boxes)
 * and `slopeCells` (floor-slope surfaces) — the static-terrain broadphase the resolution phase feeds
 * to `resolveSolids`/`resolveSlopes` (absorbing the old `tilemap-collide` cell scan). A cell is a
 * SLOPE via the `slopeL`/`slopeR` props (NOT a solid rect — the slope pass owns it), else solid via
 * `solid`, else one-way via `oneWay` (top-face-only, dropped while `dropping`).
 *
 * The cell range is padded ±1 CELL (not just the swept box's px pad): a body walking DOWNHILL floats
 * up to its downhill-stick band above the next ramp cell, so that cell sits just outside the px-padded
 * box and must still be gathered. Harmless to the candidate-keyed determinism story — tiles are
 * uniform `tileSize`, so widening the tile set never changes `resolveSolids`'s min-dim sub-step count.
 */
function gatherTiles(
  t: Tilemap,
  loX: number,
  hiX: number,
  loY: number,
  hiY: number,
  dropping: boolean,
  rects: SolidRect[],
  slopeCells: SlopeCell[],
): void {
  const ts = t.tileSize;
  const c0 = Math.max(0, Math.floor(loX / ts) - 1);
  const c1 = Math.min(t.cols - 1, Math.floor(hiX / ts) + 1);
  const r0 = Math.max(0, Math.floor(loY / ts) - 1);
  const r1 = Math.min(t.rows - 1, Math.floor(hiY / ts) + 1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const idx = t.tiles[r * t.cols + c] ?? -1;
      if (idx < 0) continue;
      const props = t.properties?.[String(idx)];
      if (!props) continue;
      const hasL = typeof props[SLOPE_L_PROP] === "number";
      const hasR = typeof props[SLOPE_R_PROP] === "number";
      if (hasL || hasR) {
        // A floor slope: surface heights up from the cell bottom at its left/right edge (an absent
        // edge defaults to 0 = cell bottom, so a single set edge is a valid wedge). Not a solid box.
        slopeCells.push({
          x: c * ts,
          y: r * ts,
          w: ts,
          h: ts,
          slopeL: hasL ? (props[SLOPE_L_PROP] as number) : 0,
          slopeR: hasR ? (props[SLOPE_R_PROP] as number) : 0,
        });
        continue;
      }
      if (props[SOLID_TILE_PROP] === true) rects.push({ x: c * ts, y: r * ts, w: ts, h: ts });
      else if (!dropping && props[ONE_WAY_TILE_PROP] === true) rects.push({ x: c * ts, y: r * ts, w: ts, h: ts, oneWay: true });
    }
  }
}

/**
 * POSITIONALLY eject pushable crate `C` from any solid (tile or solid entity) it overlaps, along the
 * minimum-translation axis — the velocity-independent push-out the PUSH pass needs (a crate shoved
 * into a wall has no velocity of its own, so the swept `resolveSolids` won't move it). Mutates `C.x`/
 * `C.y`; returns whether it moved. One-way solids are skipped (a crate isn't blocked by a pass-through
 * ledge from the side). Slope cells are ignored here.
 */
function ejectFromSolids(C: Entity, tilemap: Tilemap | undefined, solids: Entity[]): boolean {
  const box = colliderBox(C);
  const rects: SolidRect[] = [];
  const throwaway: SlopeCell[] = [];
  if (tilemap) {
    gatherTiles(tilemap, box.x - BROAD_PAD, box.x + box.w + BROAD_PAD, box.y - BROAD_PAD, box.y + box.h + BROAD_PAD, false, rects, throwaway);
  }
  for (const s of solids) {
    const sb = colliderBox(s);
    if (box.x < sb.x + sb.w && box.x + box.w > sb.x && box.y < sb.y + sb.h && box.y + box.h > sb.y) {
      rects.push(sb);
    }
  }
  let moved = false;
  for (const r of rects) {
    if (r.oneWay) continue; // a pass-through ledge never blocks a crate from the side
    const ox = overlapAmt(box.x, box.w, r.x, r.w);
    const oy = overlapAmt(box.y, box.h, r.y, r.h);
    if (ox <= 0 || oy <= 0) continue;
    if (ox <= oy) {
      const dir = box.x + box.w / 2 < r.x + r.w / 2 ? -1 : 1;
      C.x += dir * ox;
      box.x += dir * ox;
    } else {
      const dir = box.y + box.h / 2 < r.y + r.h / 2 ? -1 : 1;
      C.y += dir * oy;
      box.y += dir * oy;
    }
    moved = true;
  }
  return moved;
}
