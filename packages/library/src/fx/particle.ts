import type { BehaviorFn, World, EntityDef } from "@gitcade/sdk";
import { num, bool } from "@gitcade/sdk";

/**
 * `particle` — the internal motion+lifetime behavior every FX particle carries. It
 * is self-contained on purpose: it integrates its own velocity (so a particle does
 * NOT need the SDK `velocity` behavior), applies optional gravity, shrinks toward
 * its center as it ages (the renderer has no per-entity alpha, so shrink-to-nothing
 * is the fade), and destroys the particle SILENTLY when its ttl elapses (it does not
 * use `health-and-death`, whose death always plays a sound — particle deaths must be
 * quiet). Registered by the library so spawned particles resolve it; it is infra for
 * the FX presets rather than a standalone catalog part.
 *
 * Particle state seeded by {@link spawnBurst}: `__age`, `__ttl`, `__bw`, `__bh`.
 */
export const particle: BehaviorFn = (entity, _world, params, dt) => {
  const gravity = num(params, "gravity", 0);
  entity.vy += gravity * dt;
  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;

  const ttl = (entity.state.__ttl as number) ?? num(params, "ttl", 0.5);
  const age = ((entity.state.__age as number) ?? 0) + dt;
  entity.state.__age = age;

  if (bool(params, "shrink", true)) {
    const bw = (entity.state.__bw as number) ?? entity.w;
    const bh = (entity.state.__bh as number) ?? entity.h;
    const k = Math.max(0, 1 - age / ttl);
    const cx = entity.x + entity.w / 2;
    const cy = entity.y + entity.h / 2;
    entity.w = Math.max(1, bw * k);
    entity.h = Math.max(1, bh * k);
    entity.x = cx - entity.w / 2;
    entity.y = cy - entity.h / 2;
  }

  if (age >= ttl) _world.destroy(entity);
};

/** Options for one particle burst. */
export interface BurstOptions {
  x: number;
  y: number;
  count: number;
  /** Base speed in px/sec; each particle gets `speed * (0.5..1)`. */
  speed: number;
  /** Particle lifetime in seconds. */
  ttl: number;
  /** Particle box size in px. */
  size: number;
  /** Palette colors to cycle through. */
  colors: string[];
  /** Downward gravity in px/sec². */
  gravity?: number;
  /** Bias the spread: full radial (default), `"up"`, or `"down"`. */
  direction?: "radial" | "up" | "down";
  /** Draw layer (default 90 — above gameplay). */
  layer?: number;
  shape?: "rect" | "circle";
}

/**
 * Spawn a burst of short-lived particle entities at a point. Velocities are drawn
 * from the world's seedable RNG so bursts are DETERMINISTIC under a fixed seed
 * (the unit tests rely on this). Returns the spawned entities.
 */
export function spawnBurst(world: World, o: BurstOptions): void {
  const layer = o.layer ?? 90;
  const gravity = o.gravity ?? 0;
  for (let i = 0; i < o.count; i++) {
    const color = o.colors[i % o.colors.length] ?? "#f4f4f4";
    const def: EntityDef = {
      id: `__fx_${(world.state.__fxSeq = ((world.state.__fxSeq as number) ?? 0) + 1)}`,
      sprite: { kind: "shape", shape: o.shape ?? "rect", color },
      size: { w: o.size, h: o.size },
      position: { x: o.x - o.size / 2, y: o.y - o.size / 2 },
      tags: ["fx", "particle"],
      layer,
      behaviors: [{ type: "particle", params: { ttl: o.ttl, gravity, shrink: true } }],
    };
    const e = world.spawn(def);
    // Aim the velocity.
    let angle = world.rng() * Math.PI * 2;
    if (o.direction === "up") angle = -Math.PI / 2 + (world.rng() - 0.5) * 1.4;
    else if (o.direction === "down") angle = Math.PI / 2 + (world.rng() - 0.5) * 1.4;
    const spd = o.speed * (0.5 + world.rng() * 0.5);
    // Particles ARE world entities, so vx/vy (and the position they integrate) feed `snapshotWorld`
    // — the angle→velocity trig must be cross-engine-deterministic. (`Math.PI` above is a spec-fixed
    // constant, so it stays; only the sin/cos approximations differ across engines.)
    e.vx = world.math.cos(angle) * spd;
    e.vy = world.math.sin(angle) * spd;
    e.state.__ttl = o.ttl;
    e.state.__bw = o.size;
    e.state.__bh = o.size;
    e.state.__age = 0;
  }
}

/**
 * Resolve a world position from a game-event payload: explicit `{x,y}`, else the
 * center of the entity named by `{id}` (still alive at emit time — death events
 * fire before the entity is destroyed), else the world center.
 */
export function eventPos(world: World, data: unknown): { x: number; y: number } {
  const d = data as { x?: unknown; y?: unknown; id?: unknown } | null;
  if (d && typeof d.x === "number" && typeof d.y === "number") return { x: d.x, y: d.y };
  if (d && typeof d.id === "string") {
    const e = world.byId(d.id);
    if (e) return { x: e.cx, y: e.cy };
  }
  return { x: world.bounds.width / 2, y: world.bounds.height / 2 };
}
