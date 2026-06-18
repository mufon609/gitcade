import { describe, it, expect } from "vitest";
import { resolveSolids, applyContacts, type AABB, type SolidRect, type MovingBody } from "../src/index.js";

/**
 * 0.7.0 — the shared AABB push-out primitive (INDIE-ROADMAP Tier-0 0.3/0.4).
 *
 * `resolveSolids` snaps a moving body out of solid rects (X then Y, leading-edge),
 * zeroes the contacted velocity component, and reports contact flags — the same engine
 * `tilemap-collide` (solid CELLS) and `solid-collide` (solid ENTITIES) both feed. Swept
 * sub-stepping (0.4) keeps a fast body from tunnelling a thin rect. `applyContacts`
 * merges several resolvers' flags within one tick.
 */

const DT = 1 / 60;

function body(init: Partial<MovingBody>): MovingBody {
  return { x: 0, y: 0, w: 16, h: 16, vx: 0, vy: 0, ...init };
}

describe("resolveSolids — axis-separated push-out (0.3)", () => {
  it("lands on a solid rect from above (onGround, vy zeroed, snapped flush)", () => {
    const floor: AABB = { x: 0, y: 100, w: 200, h: 32 };
    const b = body({ x: 50, y: 90, vy: 600 }); // bottom 106 penetrates the floor top (100)
    const c = resolveSolids(b, [floor], DT);
    expect(b.y).toBe(100 - 16); // 84 — bottom flush with the floor top
    expect(b.vy).toBe(0);
    expect(c.onGround).toBe(true);
  });

  it("stops at a solid wall moving right (onWallR, vx zeroed)", () => {
    const wall: AABB = { x: 100, y: 0, w: 32, h: 200 };
    const b = body({ x: 88, y: 50, vx: 600 }); // right edge 104 penetrates the wall left face (100)
    const c = resolveSolids(b, [wall], DT);
    expect(b.x).toBe(100 - 16); // 84
    expect(b.vx).toBe(0);
    expect(c.onWallR).toBe(true);
  });

  it("stops at a solid wall moving left (onWallL)", () => {
    const wall: AABB = { x: 0, y: 0, w: 32, h: 200 };
    const b = body({ x: 28, y: 50, vx: -600 }); // left edge 28 penetrates the wall right face (32)
    const c = resolveSolids(b, [wall], DT);
    expect(b.x).toBe(32);
    expect(b.vx).toBe(0);
    expect(c.onWallL).toBe(true);
  });

  it("bonks a solid ceiling moving up (onCeiling)", () => {
    const ceil: AABB = { x: 0, y: 0, w: 200, h: 32 };
    const b = body({ x: 50, y: 26, vy: -600 }); // top 26 penetrates the ceiling bottom (32)
    const c = resolveSolids(b, [ceil], DT);
    expect(b.y).toBe(32);
    expect(b.vy).toBe(0);
    expect(c.onCeiling).toBe(true);
  });

  it("empty rects ⇒ no contact, body untouched", () => {
    const b = body({ x: 5, y: 5, vx: 100, vy: 100 });
    const c = resolveSolids(b, [], DT);
    expect(b.x).toBe(5);
    expect(b.y).toBe(5);
    expect(c.onGround || c.onCeiling || c.onWallL || c.onWallR).toBe(false);
  });

  it("resolves against the NEARER of two overlapping solids (furthest safe push)", () => {
    // Two crates whose left faces a fast-ish right-mover has both entered: push out of the nearer one.
    const a: AABB = { x: 100, y: 0, w: 40, h: 200 };
    const b2: AABB = { x: 120, y: 0, w: 40, h: 200 };
    const b = body({ x: 92, y: 50, vx: 300 }); // right edge 108 is inside crate a (100..140)
    const c = resolveSolids(b, [b2, a], DT); // order shouldn't matter
    expect(b.x).toBe(100 - 16); // pushed out of the nearer crate a (smallest left face)
    expect(c.onWallR).toBe(true);
  });
});

describe("resolveSolids — swept sub-stepping prevents tunnelling (0.4)", () => {
  it("a fast faller lands ON a thin slab instead of passing through it", () => {
    const slab: AABB = { x: 0, y: 200, w: 400, h: 8 }; // only 8px thick
    // Integrated position is 210 (bottom 226) — already BELOW the 8px slab: a single pass
    // at this position would see no contact and tunnel. vy*dt = 50px ≫ the 8px slab.
    const b = body({ x: 100, y: 210, vy: 3000 });
    const c = resolveSolids(b, [slab], DT);
    expect(c.onGround).toBe(true);
    expect(b.y).toBe(200 - 16); // caught on the slab top (184), not below it
    expect(b.vy).toBe(0);
  });

  it("a slow body is unaffected by the swept path (single byte-identical pass)", () => {
    // disp (10px) < half the 32px slab → steps==1, the exact pre-sweep resolver.
    const floor: AABB = { x: 0, y: 100, w: 200, h: 32 };
    const b = body({ x: 50, y: 90, vy: 600 });
    const c = resolveSolids(b, [floor], DT);
    expect(b.y).toBe(84);
    expect(c.onGround).toBe(true);
  });
});

describe("resolveSolids — a body sitting in a solid is not ejected sideways (0.3 lift fix)", () => {
  // Regression: a solid that has risen INTO a resting body (a lift), or a body placed
  // overlapping, penetrates more than the body's own fall this tick — the X pass must NOT
  // read that floor as a wall and fling the body off the side it should stand on.
  it("a body resting on a solid that rose into it lands while moving right, not ejected", () => {
    const floor: AABB = { x: 0, y: 100, w: 200, h: 50 }; // top y=100
    const b = body({ x: 50, y: 92, vx: 600, vy: 60 }); // bottom 108 = 8px into the floor top
    const c = resolveSolids(b, [floor], DT);
    expect(c.onWallR).toBe(false); // NOT misread as a wall
    expect(b.x).toBe(50); // not ejected sideways
    expect(b.vx).toBe(600); // horizontal motion preserved
    expect(c.onGround).toBe(true); // grounded on the solid it sits on
    expect(b.y).toBe(84); // snapped to rest on the floor top (100 - 16)
  });

  it("symmetric while moving left", () => {
    const floor: AABB = { x: 0, y: 100, w: 200, h: 50 };
    const b = body({ x: 50, y: 92, vx: -600, vy: 60 });
    const c = resolveSolids(b, [floor], DT);
    expect(c.onWallL).toBe(false);
    expect(b.x).toBe(50);
    expect(c.onGround).toBe(true);
  });

  it("a genuine wall is still resolved (the guard doesn't over-skip a shallow-X contact)", () => {
    const wall: AABB = { x: 100, y: 0, w: 32, h: 200 }; // deep Y overlap, shallow X — a real wall
    const b = body({ x: 88, y: 50, vx: 600 });
    const c = resolveSolids(b, [wall], DT);
    expect(c.onWallR).toBe(true);
    expect(b.x).toBe(84);
  });
});

describe("resolveSolids — one-way (pass-through) platforms (0.7.0)", () => {
  it("lands ON a one-way platform when falling from above (onGround + onOneWay)", () => {
    const plat: SolidRect = { x: 0, y: 100, w: 200, h: 16, oneWay: true };
    const b = body({ x: 50, y: 90, vy: 600 }); // pre-fall bottom (96) ≤ top (100) → a true land-from-above
    const c = resolveSolids(b, [plat], DT);
    expect(b.y).toBe(100 - 16); // 84 — resting flush on the platform top
    expect(b.vy).toBe(0);
    expect(c.onGround).toBe(true);
    expect(c.onOneWay).toBe(true);
  });

  it("passes UP through a one-way platform when rising (no head-bonk)", () => {
    const plat: SolidRect = { x: 0, y: 100, w: 200, h: 16, oneWay: true };
    const b = body({ x: 50, y: 96, vy: -600 }); // rising into it from below
    const c = resolveSolids(b, [plat], DT);
    expect(b.vy).toBe(-600); // velocity untouched
    expect(c.onCeiling).toBe(false);
  });

  it("is NOT blocked sideways by a one-way platform", () => {
    const plat: SolidRect = { x: 100, y: 0, w: 40, h: 200, oneWay: true };
    const b = body({ x: 88, y: 50, vx: 600 }); // would hit a solid wall, but a one-way passes
    const c = resolveSolids(b, [plat], DT);
    expect(c.onWallR).toBe(false);
    expect(b.vx).toBe(600);
  });

  it("does NOT catch a body whose pre-fall bottom was already below the top (rising through)", () => {
    const plat: SolidRect = { x: 0, y: 100, w: 200, h: 16, oneWay: true };
    const b = body({ x: 50, y: 96, vy: 60 }); // bottom (112) already past the top; pre-fall bottom (111) > 100
    const c = resolveSolids(b, [plat], DT);
    expect(c.onGround).toBe(false); // not snapped up onto it
  });

  it("a fully solid floor reports onOneWay = false even when grounded", () => {
    const floor: AABB = { x: 0, y: 100, w: 200, h: 32 };
    const b = body({ x: 50, y: 90, vy: 600 });
    const c = resolveSolids(b, [floor], DT);
    expect(c.onGround).toBe(true);
    expect(c.onOneWay).toBe(false);
  });

  it("a fast faller still lands on a thin one-way platform (swept, no tunnelling)", () => {
    const plat: SolidRect = { x: 0, y: 200, w: 400, h: 8, oneWay: true };
    // Integrated position 210 (bottom 226) is already BELOW the 8px platform — a single pass
    // would tunnel; the sweep starts from y=160 (bottom 176, above the top) and catches it.
    const b = body({ x: 100, y: 210, vy: 3000 });
    const c = resolveSolids(b, [plat], DT);
    expect(c.onGround).toBe(true);
    expect(c.onOneWay).toBe(true);
    expect(b.y).toBe(200 - 16); // caught on top, not tunnelled through
  });
});

describe("applyContacts — per-tick merge of multiple resolvers", () => {
  it("the first resolver of a tick resets; later resolvers OR within the same tick", () => {
    const s: Record<string, unknown> = {};
    applyContacts(s, 1, { onGround: false, onCeiling: false, onWallL: true, onWallR: false, onOneWay: false }); // A
    expect(s.__onWallL).toBe(true);
    expect(s.__onGround).toBe(false);
    applyContacts(s, 1, { onGround: true, onCeiling: false, onWallL: false, onWallR: false, onOneWay: false }); // B
    expect(s.__onGround).toBe(true); // OR'd in
    expect(s.__onWallL).toBe(true); // A's contact preserved (not clobbered)
  });

  it("onOneWay merges and is reset per tick like the other contact flags", () => {
    const s: Record<string, unknown> = {};
    applyContacts(s, 1, { onGround: true, onCeiling: false, onWallL: false, onWallR: false, onOneWay: true });
    expect(s.__onOneWay).toBe(true);
    // a fully-solid resolver later the SAME tick must not clear an earlier one-way ground
    applyContacts(s, 1, { onGround: true, onCeiling: false, onWallL: false, onWallR: false, onOneWay: false });
    expect(s.__onOneWay).toBe(true);
    // next tick with no one-way contact resets it
    applyContacts(s, 2, { onGround: true, onCeiling: false, onWallL: false, onWallR: false, onOneWay: false });
    expect(s.__onOneWay).toBe(false);
  });

  it("a new tick resets stale flags instead of carrying them", () => {
    const s: Record<string, unknown> = { __onGround: true, __onWallR: true, __contactTick: 1 };
    applyContacts(s, 2, { onGround: false, onCeiling: false, onWallL: false, onWallR: false, onOneWay: false });
    expect(s.__onGround).toBe(false);
    expect(s.__onWallR).toBe(false);
  });
});
