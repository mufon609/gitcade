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
 * so a plain {@link AABB} is a valid `SolidRect` and existing callers are unchanged.
 */
export interface SolidRect extends AABB {
  oneWay?: boolean;
}

/**
 * A moving AABB resolved against solid rects. Position + size + velocity, MUTATED in place
 * by {@link resolveSolids}. A runtime {@link Entity} already has these fields, so a
 * solid-collision behavior passes the entity itself.
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
   * solid.
   */
  onOneWay: boolean;
}

/**
 * Upper bound on swept sub-steps — a cost backstop for a pathologically fast body.
 * With `maxStep = minDim/2`, the resolver is tunnel-free up to a per-tick displacement of
 * `MAX_SOLID_SUBSTEPS * minDim/2` (= 8× the thinnest solid's smallest side), which clears
 * any realistic speed. A body faster than that through a very thin solid can still tunnel —
 * cap the body's speed or thicken the collider; the clamp keeps cost bounded over guarantee.
 */
const MAX_SOLID_SUBSTEPS = 16;

/**
 * The `collider.stepHeight` test for the X pass: a body that ran into a solid wall whose highest
 * blocking top is `topY` may STEP onto it — instead of being stopped — when that top is a small lip
 * (`0 < foot − topY ≤ stepHeight`) AND the body, raised so its foot rests on `topY`, has clear
 * HEADROOM (no fully-solid rect reaches down into the raised box; a one-way platform never blocks the
 * head, matching the upward Y pass). The lip itself (top exactly at `topY`) only touches the raised
 * foot, so it never counts as a headroom collision. Pure geometry — no rng/time — so step-up does not
 * perturb determinism; with `stepHeight = 0` (every body that doesn't opt in) it is never consulted.
 */
function canStepUp(body: MovingBody, rects: readonly SolidRect[], topY: number, stepHeight: number): boolean {
  const lip = body.y + body.h - topY; // how far the body's foot sits BELOW the lip's top
  if (lip <= 0 || lip > stepHeight) return false;
  const newTop = topY - body.h; // the body's top once raised to stand its foot on the lip
  const x0 = body.x;
  const x1 = body.x + body.w;
  for (const r of rects) {
    if (r.oneWay) continue; // pass-through platforms don't block the head
    // A solid strictly ABOVE the lip (`r.y < topY`) that reaches down into the raised body's vertical
    // span (`r.y + r.h > newTop`) and overlaps it horizontally would be hit by the step — block it.
    if (r.x < x1 && r.x + r.w > x0 && r.y < topY && r.y + r.h > newTop) return false;
  }
  return true;
}

/**
 * One axis-separated push-out pass: resolve `body` against the SOLID `rects` it ran
 * into, X then Y, zeroing the contacted velocity component and reporting which faces
 * touched. Each axis resolves against the LEADING edge (the cell/box that edge has
 * entered), pushing the body flush to that solid's face — when several solids contain the
 * edge (overlapping bodies, never grid cells) it takes the furthest push, the safe one.
 *
 * STEP-UP: a `stepHeight > 0` body that hits a wall whose top is a small lip is RAISED onto it (vx
 * kept, no wall) rather than stopped — see {@link canStepUp}. `stepHeight = 0` (the default) skips the
 * test entirely, so a body that doesn't opt in is byte-identical to the pre-step resolver.
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
function resolveSolidStep(body: MovingBody, rects: readonly SolidRect[], subDt: number, eps: number, stepHeight = 0): SolidContacts {
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
    let stepTopY = Infinity; // highest (smallest-y) blocking-solid top at the leading edge — the step-up target
    for (const r of rects) {
      if (r.oneWay) continue; // one-way platforms never block horizontally
      if (!(r.y < spanBot && r.y + r.h > spanTop && r.x <= edge && edge < r.x + r.w)) continue;
      if (ovY(r) < ovX(r)) continue; // a floor/ceiling the body sits in, not a wall — the Y pass owns it
      if (r.x < stop) stop = r.x;
      if (r.y < stepTopY) stepTopY = r.y;
    }
    if (stop < Infinity) {
      // STEP-UP (collider.stepHeight): a small lip the body can climb is stepped ONTO — body raised,
      // vx kept, no wall — instead of stopping it dead. Gated on stepHeight>0, so a body without it
      // takes the EXACT original wall path (byte-identical). See {@link canStepUp}.
      if (stepHeight > 0 && canStepUp(body, rects, stepTopY, stepHeight)) {
        body.y = stepTopY - body.h;
      } else {
        body.x = stop - body.w;
        body.vx = 0;
        onWallR = true;
      }
    }
  } else if (body.vx < 0) {
    const edge = body.x; // leading left edge
    let stop = -Infinity;
    let stepTopY = Infinity;
    for (const r of rects) {
      if (r.oneWay) continue; // one-way platforms never block horizontally
      const right = r.x + r.w;
      if (!(r.y < spanBot && r.y + r.h > spanTop && r.x <= edge && edge < right)) continue;
      if (ovY(r) < ovX(r)) continue; // a floor/ceiling the body sits in, not a wall — the Y pass owns it
      if (right > stop) stop = right;
      if (r.y < stepTopY) stepTopY = r.y;
    }
    if (stop > -Infinity) {
      if (stepHeight > 0 && canStepUp(body, rects, stepTopY, stepHeight)) {
        body.y = stepTopY - body.h;
      } else {
        body.x = stop;
        body.vx = 0;
        onWallL = true;
      }
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
 * behind platformer terrain AND entity-vs-entity solids.
 * `body` is mutated in place (position snapped out of the rects, the contacted velocity
 * component zeroed) and the contact flags are returned for a mover to read (jump off a
 * ground contact, etc.). The `rects` are whatever the caller treats as solid this tick: the
 * collision-resolution phase ({@link World.resolveBodies}) feeds the solid tile cells AND solid
 * entities' boxes — so a crate/ledge/lift is exactly as solid as a tile. The phase runs AFTER the
 * velocity integrator (the whole behavior pass), so it corrects the position the integrator just
 * produced, in the same tick.
 *
 * Swept sub-stepping: each sub-step's displacement is capped to half the thinnest
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
  opts?: { eps?: number; stepHeight?: number },
): SolidContacts {
  const eps = opts?.eps ?? 0.001;
  // Max lip (px) the body auto-steps onto instead of being walled (collider.stepHeight). 0 ⇒ off ⇒
  // the X pass takes the exact original wall path, so an omitted/0 stepHeight is byte-identical.
  const stepHeight = opts?.stepHeight ?? 0;
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
  if (steps === 1) return resolveSolidStep(body, rects, dt, eps, stepHeight);

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
    const c = resolveSolidStep(body, rects, subDt, eps, stepHeight);
    onGround = onGround || c.onGround;
    onCeiling = onCeiling || c.onCeiling;
    onWallL = onWallL || c.onWallL;
    onWallR = onWallR || c.onWallR;
    onOneWay = onOneWay || c.onOneWay;
  }
  return { onGround, onCeiling, onWallL, onWallR, onOneWay };
}

/**
 * Merge a solid resolver's contact flags into the entity's body component {@link BodyComponent.contacts}
 * so MULTIPLE resolvers on one entity COMBINE within a tick instead of clobbering: the FIRST
 * resolver each tick (detected via the `tick` stamp — pass `world.frame`, constant within a
 * tick and unique across ticks) resets the five flags to its own contacts; later passes OR
 * theirs in. So the resolution phase's solid pass and slope pass COMBINE within a tick — a body
 * reads `contacts.onGround` as "standing on a solid OR a slope" — and a mover (`move-platformer`)
 * sees the union. Writing the flags directly (no stamp) would make whichever pass ran last win and
 * silently drop the other's contacts.
 *
 * `onOneWay` merges the same way: true when ANY resolver this tick grounded the body on a
 * one-way platform. A mover reads it to gate "down+jump drops through"; on mixed one-way +
 * solid ground the drop is a harmless no-op (the solid floor still holds).
 *
 * Writes the TYPED `entity.body.contacts`/`entity.body.contactTick` fields — the home of the
 * contact protocol. The target is typed structurally (just the two fields it touches) so
 * `entity.body` satisfies it and a unit test can pass a minimal stub.
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

/**
 * A floor-SLOPE cell fed to {@link resolveSlopes}. `x`/`y`/`w`/`h` are the cell's AABB
 * (top-left + size, exactly as the resolution phase builds a solid cell); `slopeL`/`slopeR` are the
 * walkable surface height in px UP FROM THE CELL BOTTOM at the cell's left/right edge (0 = the
 * cell bottom, `h` = the cell top). The surface is the straight line between them; the cell is
 * solid floor below it. Covers 45° (`0`→`h`) and gentler linear ramps, and tiles seamlessly
 * (adjacent cells that share an edge height form one continuous ramp).
 */
export interface SlopeCell extends AABB {
  slopeL: number;
  slopeR: number;
}

/** The contact a {@link resolveSlopes} pass reports: grounded on a slope surface. */
export interface SlopeContact {
  onGround: boolean;
}

/**
 * Rest a moving AABB's BOTTOM on a tilemap floor-SLOPE surface — the non-AABB companion to
 * {@link resolveSolids}, which can't express a surface whose height
 * varies across the body's x-span. The resolution phase runs it as a SECOND pass AFTER the solid
 * AABB pass, so it samples the body's already-settled x (a wall at a slope's base has clamped it).
 *
 * It evaluates the surface Y under the body's CENTER x (the standard AABB-on-slope sample point —
 * predictable, with at most a half-body clip/float on the steepest 45° ramp). If the body is NOT
 * rising (`vy >= 0`) and its bottom is at/below that surface OR within a small **downhill-stick**
 * band above it, it snaps the bottom flush to the surface, zeroes a downward `vy`, and reports
 * `onGround`. The stick band = `|vx|*dt` (the most a body drops walking down a ≤45° slope in one
 * tick) + a 1px margin, so a body walking downhill sticks to the ramp instead of stair-stepping
 * into the air. A RISING body (`vy < 0`, a jump) is never snapped — floor slopes have no underside
 * in v1, so a jump passes up through.
 *
 * Only `body.y`/`body.vy` are ever changed (never `body.x`), so it composes cleanly with the X the
 * solid pass already settled. Empty `slopeCells` ⇒ no contact, body untouched — so a map with no
 * slope cells is byte-identical (the caller should skip this pass entirely in that case).
 */
export function resolveSlopes(body: MovingBody, slopeCells: readonly SlopeCell[], dt: number): SlopeContact {
  if (slopeCells.length === 0) return { onGround: false };
  if (!Number.isFinite(body.vy)) body.vy = 0;
  if (body.vy < 0) return { onGround: false }; // rising — pass up through a floor slope

  // Sample the surface under the body's center x. At most one cell contains it (cells don't
  // overlap); a body straddling a seam matches both, which share the edge height, so `min` is safe.
  const sampleX = body.x + body.w / 2;
  let surfaceY = Infinity;
  for (const cell of slopeCells) {
    const right = cell.x + cell.w;
    if (sampleX < cell.x || sampleX > right) continue;
    const t = (sampleX - cell.x) / cell.w; // 0..1 across the cell (sampleX is in range here)
    const heightPx = cell.slopeL + (cell.slopeR - cell.slopeL) * t;
    const sy = cell.y + cell.h - heightPx;
    if (sy < surfaceY) surfaceY = sy;
  }
  if (!Number.isFinite(surfaceY)) return { onGround: false }; // no slope cell under the body's center

  const bottom = body.y + body.h;
  // Downhill-stick band, capped at one tile so a fast-horizontal FALLER doesn't snap from far above.
  const snapDown = Math.min(slopeCells[0].h, Math.abs(body.vx) * dt + 1);
  if (bottom - surfaceY >= -snapDown) {
    body.y = surfaceY - body.h;
    if (body.vy > 0) body.vy = 0;
    return { onGround: true };
  }
  return { onGround: false };
}
