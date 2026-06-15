import type { Entity, World, ResolvedParams } from "@gitcade/sdk";

/**
 * Shared helpers for library behaviors/systems. These are internal — they are not
 * part of any frozen contract and never reach into the SDK schema. They exist so
 * the parts stay small, consistent, and free of copy-pasted vector/clone code.
 */

/** A 2D vector / point as authored in params (structural `x`/`y` literals allowed). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Read a `{ x, y }` param with per-axis fallbacks. */
export function vec2(params: ResolvedParams, key: string, fallback: Vec2 = { x: 0, y: 0 }): Vec2 {
  const v = params[key] as Partial<Vec2> | undefined;
  if (v && typeof v === "object") {
    return { x: typeof v.x === "number" ? v.x : fallback.x, y: typeof v.y === "number" ? v.y : fallback.y };
  }
  return { ...fallback };
}

/** Read an array-of-points param (`[{x,y}, ...]`), filtering malformed entries. */
export function points(params: ResolvedParams, key: string): Vec2[] {
  const v = params[key];
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is Vec2 => !!p && typeof p === "object" && typeof (p as Vec2).x === "number" && typeof (p as Vec2).y === "number")
    .map((p) => ({ x: p.x, y: p.y }));
}

/** Center-to-center vector from `a` to `b`. */
export function toward(a: Entity, b: Entity): Vec2 {
  return { x: b.cx - a.cx, y: b.cy - a.cy };
}

/** Euclidean length of a vector. */
export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Unit vector (returns `{0,0}` for a zero vector). */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

/**
 * Drive an entity toward a desired velocity, snapping instantly when no
 * acceleration is given, or easing toward it at `accel` px/sec² when one is.
 * Movement parts SET velocity and rely on the SDK `velocity` behavior (ordered
 * AFTER them) to integrate position — the same composition Pong uses.
 */
export function applyVelocity(entity: Entity, desiredVx: number, desiredVy: number, accel: number, dt: number): void {
  if (accel <= 0) {
    entity.vx = desiredVx;
    entity.vy = desiredVy;
    return;
  }
  const step = accel * dt;
  entity.vx += clampMag(desiredVx - entity.vx, step);
  entity.vy += clampMag(desiredVy - entity.vy, step);
}

function clampMag(delta: number, max: number): number {
  if (delta > max) return max;
  if (delta < -max) return -max;
  return delta;
}

/** Resolve a `lockAxis` param to a constrained-movement mode. */
export function lockAxis(value: unknown): "x" | "y" | "none" {
  return value === "x" || value === "y" ? value : "none";
}

/**
 * Spawn a fresh entity from a prototype entity-definition embedded in a part's
 * params. The prototype's `$cfg` references were already resolved when the
 * owning scene loaded, so this deep-clones the resolved def, assigns a unique id,
 * and optionally overrides its spawn position. Used by `shoot`, `melee-swing`,
 * `ai-aim-and-fire`, `wave-spawner`, and `lives-respawn`.
 */
export function spawnFrom(
  world: World,
  prototype: unknown,
  opts: { idPrefix?: string; position?: Vec2; state?: Record<string, unknown> } = {},
): Entity | null {
  if (!prototype || typeof prototype !== "object") return null;
  const def = structuredClone(prototype) as Record<string, unknown>;
  const base = (def.id as string) || opts.idPrefix || "spawn";
  def.id = `${opts.idPrefix ?? base}#${nextSpawnSeq(world)}`;
  if (opts.position) def.position = { x: opts.position.x, y: opts.position.y };
  if (opts.state) def.state = { ...(def.state as Record<string, unknown> | undefined), ...opts.state };
  // The SDK schema applies entity defaults at scene-parse time; runtime-spawned
  // defs bypass that path, so backfill the fields buildEntity reads directly.
  def.sprite ??= { kind: "none" };
  def.size ??= { w: 16, h: 16 };
  def.position ??= { x: 0, y: 0 };
  def.behaviors ??= [];
  def.tags ??= [];
  def.layer ??= 0;
  return world.spawn(def as never);
}

/** Per-world monotonically increasing spawn counter (kept off the public state bag). */
function nextSpawnSeq(world: World): number {
  const key = "__spawnSeq";
  const n = ((world.state[key] as number) ?? 0) + 1;
  world.state[key] = n;
  return n;
}

/** Snap a world point to the CENTER of the grid cell that contains it (G4). */
export function snapToGrid(x: number, y: number, tileSize: number): Vec2 {
  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);
  return { x: col * tileSize + tileSize / 2, y: row * tileSize + tileSize / 2 };
}

/** Rectangle in world space (placement bounds). */
export interface CellBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RandomFreeCellOpts {
  /** Grid cell size in px. */
  tileSize: number;
  /** Tag whose live entities mark a cell occupied (by their CENTER). */
  occupiedTag: string;
  /** Placement region (defaults to the whole world). */
  bounds?: CellBounds;
  /** Optional tilemap gate — only cells whose tile is buildable/walkable qualify. */
  require?: "walkable" | "buildable";
}

/**
 * A uniformly-random FREE grid cell center within `bounds` (default: the whole
 * world), excluding every cell already occupied by a live `occupiedTag` entity and
 * — when `require` is set and the scene has a tilemap — every cell failing the
 * tilemap gate. Uses `world.rng` for deterministic replay, never `Math.random`.
 * Returns the cell's center point, or `null` if no cell is free (G4).
 *
 * This is the one-line replacement for the ~60 lines of occupancy-set + retry +
 * fallback that games hand-rolled (e.g. Snake food); "first food on the wall" and
 * stacked spawns are impossible by construction (out-of-bounds and occupied cells
 * are excluded up front).
 */
export function randomFreeCell(world: World, opts: RandomFreeCellOpts): Vec2 | null {
  const ts = opts.tileSize;
  const b = opts.bounds ?? { x: 0, y: 0, w: world.bounds.width, h: world.bounds.height };
  const cols = Math.floor(b.w / ts);
  const rows = Math.floor(b.h / ts);
  if (cols <= 0 || rows <= 0) return null;

  // Mark cells occupied by any live entity carrying occupiedTag (keyed on center).
  const occupied = new Set<number>();
  for (const e of world.query(opts.occupiedTag)) {
    const col = Math.floor((e.cx - b.x) / ts);
    const row = Math.floor((e.cy - b.y) / ts);
    if (col >= 0 && row >= 0 && col < cols && row < rows) occupied.add(row * cols + col);
  }

  // Collect free + gate-passing cells, then pick one uniformly with world.rng.
  const free: number[] = [];
  for (let i = 0; i < cols * rows; i++) {
    if (occupied.has(i)) continue;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = b.x + col * ts + ts / 2;
    const cy = b.y + row * ts + ts / 2;
    if (opts.require && !passesRequire(world, cx, cy, opts.require)) continue;
    free.push(i);
  }
  if (free.length === 0) return null;

  const pick = free[Math.floor(world.rng() * free.length)] ?? free[0];
  const col = pick % cols;
  const row = Math.floor(pick / cols);
  return { x: b.x + col * ts + ts / 2, y: b.y + row * ts + ts / 2 };
}

/** Tilemap gate for {@link randomFreeCell}; permissive when the scene has no tilemap. */
function passesRequire(world: World, cx: number, cy: number, require: "walkable" | "buildable"): boolean {
  if (!world.tilemap) return true;
  if (require === "buildable") return world.isBuildable(cx, cy);
  // walkable: empty/out-of-bounds fails; a decorated tile defaults permissive.
  const idx = world.tileAt(cx, cy);
  if (idx < 0) return false;
  return world.tilemap.properties?.[String(idx)]?.walkable ?? true;
}

/** Read/create a namespaced scratch object on `world.state` for stateful systems. */
export function systemState<T extends Record<string, unknown>>(world: World, key: string, init: T): T {
  const existing = world.state[key];
  if (existing && typeof existing === "object") return existing as T;
  const fresh = { ...init };
  world.state[key] = fresh;
  return fresh;
}
