import type { Entity } from "./entity.js";

/** An axis-aligned bounding box. */
export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True if two AABBs overlap (touching edges do NOT count as overlap). */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** True if two entities' boxes overlap. */
export function entitiesOverlap(a: Entity, b: Entity): boolean {
  return aabbOverlap(a, b);
}

/**
 * The minimum-translation axis of overlap between two entities: `"x"` if the
 * horizontal penetration is smaller, else `"y"`. Used by reflection to decide
 * which velocity component to flip on a paddle/wall hit.
 */
export function overlapAxis(a: Entity, b: Entity): "x" | "y" {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return overlapX < overlapY ? "x" : "y";
}

/**
 * A solid rect fed to {@link resolveSolids}. Extends {@link AABB} with an optional
 * `oneWay` flag: a one-way (pass-through) platform is solid ONLY when a body LANDS on
 * it from above — the body jumps up THROUGH it (no head-bonk), is never blocked by it
 * sideways, and (with the mover's drop-through) can fall down through it, but rests on
 * its top when falling onto it. Omitted/false ⇒ a fully solid rect (every face blocks),
 * so a plain {@link AABB} is a valid `SolidRect` and existing callers are unchanged
 * (0.7.0 one-way platforms).
 */
export interface SolidRect extends AABB {
  oneWay?: boolean;
}

/**
 * A moving AABB resolved against solid rects (INDIE-ROADMAP Tier-0 0.3/0.4). Position
 * + size + velocity, MUTATED in place by {@link resolveSolids}. A runtime {@link Entity}
 * already has these fields, so a solid-collision behavior passes the entity itself.
 */
export interface MovingBody {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
}

/** The four faces an AABB can be in contact with after a solid resolve. */
export interface SolidContacts {
  onGround: boolean;
  onCeiling: boolean;
  onWallL: boolean;
  onWallR: boolean;
  /**
   * The ground contact this resolve came from a ONE-WAY platform (not a fully solid
   * floor) — lets a mover offer "down+jump to drop through" only when standing on
   * pass-through terrain. False whenever `onGround` is false OR the floor was fully
   * solid (0.7.0 one-way platforms).
   */
  onOneWay: boolean;
}

/**
 * Upper bound on swept sub-steps — a cost backstop for a pathologically fast body (0.4).
 * With `maxStep = minDim/2`, the resolver is tunnel-free up to a per-tick displacement of
 * `MAX_SOLID_SUBSTEPS * minDim/2` (= 8× the thinnest solid's smallest side), which clears
 * any realistic speed. A body faster than that through a very thin solid can still tunnel —
 * cap the body's speed or thicken the collider; the clamp keeps cost bounded over guarantee.
 */
const MAX_SOLID_SUBSTEPS = 16;

/**
 * One axis-separated push-out pass: resolve `body` against the SOLID `rects` it ran
 * into, X then Y, zeroing the contacted velocity component and reporting which faces
 * touched. Each axis resolves against the LEADING edge (the cell/box that edge has
 * entered), pushing the body flush to that solid's face — when several solids contain the
 * edge (overlapping bodies, never grid cells) it takes the furthest push, the safe one.
 *
 * The X pass guards against misreading a floor/ceiling as a wall two ways: it tests the
 * body's vertical span from BEFORE this step's own fall (`y - vy*subDt`), so a floor the
 * integrator just sank the body into isn't a candidate; AND it skips any rect the body
 * penetrates more shallowly in Y than in X — the min-translation axis test, which catches
 * a solid the body is sitting IN that its own fall did NOT create (a lift risen into it, a
 * body placed/teleported overlapping). Without it, a body standing on such a solid while
 * moving horizontally would be ejected sideways off a surface it should just stand on.
 *
 * A ONE-WAY rect (`r.oneWay`) is solid on a SINGLE face: it participates only in the
 * downward Y pass, and only when the body's PRE-fall bottom was at/above its top (a true
 * land-from-above). Both X passes and the upward Y pass skip it — so a body runs past it
 * sideways and jumps up THROUGH it freely. Resting on one reports `onOneWay`.
 */
function resolveSolidStep(body: MovingBody, rects: readonly SolidRect[], subDt: number, eps: number): SolidContacts {
  let onGround = false;
  let onCeiling = false;
  let onWallL = false;
  let onWallR = false;
  let onOneWay = false;

  // Current overlap depth of the body with rect `r` on each axis (>0 while overlapping).
  // The X pass compares them to tell a wall (shallower in X) from a floor/ceiling the body
  // is resting in (shallower in Y) — the minimum-translation axis.
  const ovX = (r: AABB): number => Math.min(body.x + body.w, r.x + r.w) - Math.max(body.x, r.x);
  const ovY = (r: AABB): number => Math.min(body.y + body.h, r.y + r.h) - Math.max(body.y, r.y);

  // --- X axis over the PRE-step vertical span (see the doc comment's landing note). ---
  const prevY = body.y - body.vy * subDt;
  const spanTop = prevY;
  const spanBot = prevY + body.h - eps;
  if (body.vx > 0) {
    const edge = body.x + body.w - eps; // leading right edge
    let stop = Infinity;
    for (const r of rects) {
      if (r.oneWay) continue; // one-way platforms never block horizontally
      if (!(r.y < spanBot && r.y + r.h > spanTop && r.x <= edge && edge < r.x + r.w)) continue;
      if (ovY(r) < ovX(r)) continue; // a floor/ceiling the body sits in, not a wall — the Y pass owns it
      if (r.x < stop) stop = r.x;
    }
    if (stop < Infinity) {
      body.x = stop - body.w;
      body.vx = 0;
      onWallR = true;
    }
  } else if (body.vx < 0) {
    const edge = body.x; // leading left edge
    let stop = -Infinity;
    for (const r of rects) {
      if (r.oneWay) continue; // one-way platforms never block horizontally
      const right = r.x + r.w;
      if (!(r.y < spanBot && r.y + r.h > spanTop && r.x <= edge && edge < right)) continue;
      if (ovY(r) < ovX(r)) continue; // a floor/ceiling the body sits in, not a wall — the Y pass owns it
      if (right > stop) stop = right;
    }
    if (stop > -Infinity) {
      body.x = stop;
      body.vx = 0;
      onWallL = true;
    }
  }

  // --- Y axis over the (resolved) horizontal span. ---
  const spanL = body.x;
  const spanR = body.x + body.w - eps;
  if (body.vy > 0) {
    const edge = body.y + body.h - eps; // leading bottom edge
    const prevBot = prevY + body.h; // body bottom BEFORE this slice's fall
    let stop = Infinity;
    let stopOneWay = false;
    for (const r of rects) {
      if (!(r.x < spanR && r.x + r.w > spanL && r.y <= edge && edge < r.y + r.h)) continue;
      // One-way: solid only when LANDING from above — the body's pre-fall bottom was at/above
      // its top. A body rising through it, or already overlapping it from below, passes freely.
      if (r.oneWay && prevBot > r.y + eps) continue;
      if (r.y < stop) {
        stop = r.y;
        stopOneWay = r.oneWay === true;
      }
    }
    if (stop < Infinity) {
      body.y = stop - body.h;
      body.vy = 0;
      onGround = true;
      onOneWay = stopOneWay;
    }
  } else if (body.vy < 0) {
    const edge = body.y; // leading top edge
    let stop = -Infinity;
    for (const r of rects) {
      if (r.oneWay) continue; // can't bonk your head on a one-way platform
      const bottom = r.y + r.h;
      if (r.x < spanR && r.x + r.w > spanL && r.y <= edge && edge < bottom && bottom > stop) stop = bottom;
    }
    if (stop > -Infinity) {
      body.y = stop;
      body.vy = 0;
      onCeiling = true;
    }
  }

  return { onGround, onCeiling, onWallL, onWallR, onOneWay };
}

/**
 * Resolve a moving AABB against a set of SOLID rects — the shared push-out primitive
 * behind platformer terrain AND entity-vs-entity solids (INDIE-ROADMAP Tier-0 0.3).
 * `body` is mutated in place (position snapped out of the rects, the contacted velocity
 * component zeroed) and the contact flags are returned for a mover to read (jump off a
 * ground contact, etc.). The `rects` are whatever the caller treats as solid this tick:
 * `tilemap-collide` feeds the solid tile cells, `solid-collide` feeds solid entities'
 * boxes — so a crate/ledge/lift is exactly as solid as a tile. Order the calling
 * behavior AFTER the velocity integrator: it corrects the position the integrator just
 * produced, in the same tick.
 *
 * Swept sub-stepping (0.4): each sub-step's displacement is capped to half the thinnest
 * solid, so a fast body (a hard fall, a projectile) won't tunnel a thin rect between ticks
 * — up to the {@link MAX_SOLID_SUBSTEPS} budget, which covers any realistic speed (beyond
 * it an extremely fast body through a very thin solid can still slip through). A body
 * moving less than that cap in a tick — the common case — runs as a single pass that is
 * byte-identical to the non-swept resolver, so existing slow-body behavior is unchanged.
 * Empty `rects` ⇒ no contact, body untouched.
 *
 * Contact flags are MOTION-derived: a face is reported on the axis the body is moving INTO
 * a solid. A body resting motionless on a floor (`vy === 0`) reports no `onGround` that
 * tick — fine for a gravity mover (gravity re-applies `vy` every tick, so the contact is
 * re-detected), but read flags off a static body with that in mind.
 */
export function resolveSolids(
  body: MovingBody,
  rects: readonly SolidRect[],
  dt: number,
  opts?: { eps?: number },
): SolidContacts {
  const eps = opts?.eps ?? 0.001;
  // A non-finite velocity (garbage in) would poison position via the integrator and make
  // `steps` NaN; treat it as 0 so the resolver degrades safely instead of propagating it.
  if (!Number.isFinite(body.vx)) body.vx = 0;
  if (!Number.isFinite(body.vy)) body.vy = 0;
  if (rects.length === 0)
    return { onGround: false, onCeiling: false, onWallL: false, onWallR: false, onOneWay: false };

  let minDim = Infinity;
  for (const r of rects) {
    if (r.w < minDim) minDim = r.w;
    if (r.h < minDim) minDim = r.h;
  }
  const maxStep = Math.max(eps, minDim * 0.5);
  const dispX = body.vx * dt;
  const dispY = body.vy * dt;
  let steps = Math.ceil(Math.max(Math.abs(dispX), Math.abs(dispY)) / maxStep);
  if (!Number.isFinite(steps) || steps < 1) steps = 1;
  if (steps > MAX_SOLID_SUBSTEPS) steps = MAX_SOLID_SUBSTEPS;

  // Fast path: a slow body resolves in one pass at its integrated position — no rewind,
  // so the result is bit-for-bit the pre-sweep resolver (what every shipped slow body sees).
  if (steps === 1) return resolveSolidStep(body, rects, dt, eps);

  // Swept: rewind to the pre-integration position, then advance + resolve in equal slices.
  // A slice that makes contact zeroes its velocity component, so later slices stop there.
  body.x -= dispX;
  body.y -= dispY;
  const subDt = dt / steps;
  let onGround = false;
  let onCeiling = false;
  let onWallL = false;
  let onWallR = false;
  let onOneWay = false;
  for (let i = 0; i < steps; i++) {
    body.x += body.vx * subDt;
    body.y += body.vy * subDt;
    const c = resolveSolidStep(body, rects, subDt, eps);
    onGround = onGround || c.onGround;
    onCeiling = onCeiling || c.onCeiling;
    onWallL = onWallL || c.onWallL;
    onWallR = onWallR || c.onWallR;
    onOneWay = onOneWay || c.onOneWay;
  }
  return { onGround, onCeiling, onWallL, onWallR, onOneWay };
}

/**
 * Merge a solid resolver's contact flags into the entity's first-class {@link Entity.contacts}
 * so MULTIPLE resolvers on one entity COMBINE within a tick instead of clobbering: the FIRST
 * resolver each tick (detected via the `tick` stamp — pass `world.frame`, constant within a
 * tick and unique across ticks) resets the five flags to its own contacts; later resolvers OR
 * theirs in. So an entity carrying both `tilemap-collide` and `solid-collide` reads
 * `contacts.onGround` as "standing on a tile OR a solid entity", in any behavior order, and a
 * mover (`move-platformer`) sees the union. Writing the flags directly (no stamp) would make
 * whichever resolver ran last win and silently drop the other's contacts.
 *
 * `onOneWay` merges the same way: true when ANY resolver this tick grounded the body on a
 * one-way platform. A mover reads it to gate "down+jump drops through"; on mixed one-way +
 * solid ground the drop is a harmless no-op (the solid floor still holds).
 *
 * Writes the TYPED `entity.contacts`/`entity.contactTick` fields — the contract home of the
 * contact protocol (0.8.0). The target is typed structurally (just the two fields it touches)
 * so the runtime {@link Entity} satisfies it and a unit test can pass a minimal stub.
 */
export function applyContacts(target: { contacts: SolidContacts; contactTick: number }, tick: number, c: SolidContacts): void {
  const fresh = target.contactTick !== tick;
  target.contactTick = tick;
  const cur = target.contacts;
  cur.onGround = (!fresh && cur.onGround) || c.onGround;
  cur.onCeiling = (!fresh && cur.onCeiling) || c.onCeiling;
  cur.onWallL = (!fresh && cur.onWallL) || c.onWallL;
  cur.onWallR = (!fresh && cur.onWallR) || c.onWallR;
  cur.onOneWay = (!fresh && cur.onOneWay) || c.onOneWay;
}
