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

/** Read/create a namespaced scratch object on `world.state` for stateful systems. */
export function systemState<T extends Record<string, unknown>>(world: World, key: string, init: T): T {
  const existing = world.state[key];
  if (existing && typeof existing === "object") return existing as T;
  const fresh = { ...init };
  world.state[key] = fresh;
  return fresh;
}
