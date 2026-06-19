import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry } from "../src/index.js";
import { Renderer } from "../src/runtime/renderer.js";
import type { ShapeSprite } from "../src/schema/sprite.js";

/**
 * 1.10.0 — render interpolation extended from POSITION-ONLY (1.8.0) to the FULL render transform:
 * rotation (shortest-arc) and per-axis scale (flip-snapped), so a spinning `face-angle` sprite or a
 * scaling `tween` is as smooth as a moving body. Pins: the rotation/scale alpha endpoints + midpoint,
 * the ±π shortest-arc wrap (a `face-angle`/`tween` discontinuity must NOT unwind the long way), the
 * `face-velocity` sign-flip snap (lerping a scale flip through 0 would collapse the sprite), the
 * interaction with position interpolation, and the alpha-1 byte-identical default. Render-only — the
 * simulation never reads `body.prevRotation`/`prevScaleX/Y`, so headless play is byte-identical.
 */
const RECT: ShapeSprite = { kind: "shape", shape: "rect", color: "#fff" };
const TAU = Math.PI * 2;

/** A ctx stub that records rotate()/scale() args AND the effective fillRect screen position. */
function recCtx() {
  const rects: Array<{ x: number; y: number }> = [];
  const rotates: number[] = [];
  const scales: Array<{ x: number; y: number }> = [];
  let tx = 0, ty = 0;
  const stack: Array<[number, number]> = [];
  const ctx = {
    save() { stack.push([tx, ty]); },
    restore() { const p = stack.pop(); if (p) { tx = p[0]; ty = p[1]; } },
    translate(x: number, y: number) { tx += x; ty += y; },
    rotate(a: number) { rotates.push(a); },
    scale(x: number, y: number) { scales.push({ x, y }); },
    fillRect(x: number, y: number) { rects.push({ x: tx + x, y: ty + y }); },
    strokeRect() {}, beginPath() {}, ellipse() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    closePath() {}, fillText() {}, drawImage() {},
    set fillStyle(_v: string) {}, set strokeStyle(_v: string) {}, set lineWidth(_v: number) {},
    set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    set globalAlpha(_v: number) {}, get globalAlpha() { return 1; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, rotates, scales };
}

function makeWorld(viewport = 480): World {
  return new World({ bounds: { width: viewport, height: viewport }, config: {}, registry: createDefaultRegistry() });
}
/** An entity with explicit prev-vs-cur rotation/scale (position held still to isolate the axis under test). */
function addEntity(world: World, opts: { rotation?: number; prevRotation?: number; scaleX?: number; prevScaleX?: number; scaleY?: number; prevScaleY?: number }): Entity {
  const e = new Entity({ id: "e", x: 100, y: 100, w: 10, h: 10, layer: 0, sprite: RECT });
  e.body.prevX = 100; e.body.prevY = 100; // no position change — isolate rotation/scale
  e.rotation = opts.rotation ?? 0; e.body.prevRotation = opts.prevRotation ?? e.rotation;
  e.scaleX = opts.scaleX ?? 1; e.body.prevScaleX = opts.prevScaleX ?? e.scaleX;
  e.scaleY = opts.scaleY ?? 1; e.body.prevScaleY = opts.prevScaleY ?? e.scaleY;
  world.add(e);
  return e;
}

// The renderer skips the transform entirely at the identity (no rotate call), so the EFFECTIVE drawn
// rotation when nothing was recorded is 0 — the byte-identical optimization that already existed for a
// statically-unrotated entity. Read through this so an interpolation that lands at angle 0 reads as 0.
const eff = (rotates: number[]): number => rotates[0] ?? 0;

describe("render transform interpolation — rotation", () => {
  it("alpha 0/0.5/1 draws prev / midpoint / cur", () => {
    const world = makeWorld();
    addEntity(world, { prevRotation: 0.2, rotation: 1.0 }); // non-identity endpoints so the transform always fires
    const a0 = recCtx(); new Renderer(a0.ctx).render(world, undefined, 0);
    const a5 = recCtx(); new Renderer(a5.ctx).render(world, undefined, 0.5);
    const a1 = recCtx(); new Renderer(a1.ctx).render(world, undefined, 1);
    expect(eff(a0.rotates)).toBeCloseTo(0.2, 6); // prev
    expect(eff(a5.rotates)).toBeCloseTo(0.6, 6); // midpoint
    expect(eff(a1.rotates)).toBeCloseTo(1.0, 6); // cur
  });

  it("interpolates along the SHORTEST arc across the ±π wrap (a face-angle branch-cut jump)", () => {
    const world = makeWorld();
    // prev just below +π, cur just above −π: a 0.2 rad step across the atan2 branch cut.
    addEntity(world, { prevRotation: Math.PI - 0.1, rotation: -Math.PI + 0.1 });
    const { ctx, rotates } = recCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    // Short way is +0.2 across ±π (NOT −(2π−0.2) the long way). Midpoint sits at ±π (≡ same angle).
    const normToPi = Math.atan2(Math.sin(eff(rotates)), Math.cos(eff(rotates)));
    expect(Math.abs(Math.abs(normToPi) - Math.PI)).toBeLessThan(1e-6); // at ±π, not near 0
  });

  it("a spin-loop wrap (tween rotation 2π→0) interpolates seamlessly, not backward a full turn", () => {
    const world = makeWorld();
    addEntity(world, { prevRotation: TAU - 0.05, rotation: 0.05 }); // wrapped past 2π
    const { ctx, rotates } = recCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    // Seamless: drawn ≡ 0 (mod 2π) within ~0.05, NOT ~π (which a long-way lerp of 6.23→0.05 would give).
    const drawn = Math.atan2(Math.sin(eff(rotates)), Math.cos(eff(rotates)));
    expect(Math.abs(drawn)).toBeLessThan(0.06);
  });

  it("alpha 1 is byte-identical: draws the raw cur rotation", () => {
    const world = makeWorld();
    addEntity(world, { prevRotation: 0.3, rotation: 1.2 });
    const { ctx, rotates } = recCtx();
    new Renderer(ctx).render(world, undefined, 1);
    expect(eff(rotates)).toBe(1.2);
  });
});

describe("render transform interpolation — scale", () => {
  it("alpha 0.5 draws the midpoint of a same-sign scale change (a tween pop)", () => {
    const world = makeWorld();
    addEntity(world, { prevScaleX: 1, scaleX: 2, prevScaleY: 1, scaleY: 3 });
    const { ctx, scales } = recCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    expect(scales[0].x).toBeCloseTo(1.5, 6);
    expect(scales[0].y).toBeCloseTo(2, 6);
  });

  it("SNAPS a sign flip (face-velocity mirror) instead of lerping through 0 (sprite collapse)", () => {
    const world = makeWorld();
    addEntity(world, { prevScaleX: 1, scaleX: -1 }); // a face-velocity left-turn
    const { ctx, scales } = recCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    expect(scales[0].x).toBe(-1); // drawn at cur (flipped), NOT 0 (which would collapse the sprite)
  });

  it("alpha 1 is byte-identical: draws the raw cur scale", () => {
    const world = makeWorld();
    addEntity(world, { prevScaleX: 1, scaleX: 2, prevScaleY: 1, scaleY: 2 });
    const { ctx, scales } = recCtx();
    new Renderer(ctx).render(world, undefined, 1);
    expect(scales[0]).toEqual({ x: 2, y: 2 });
  });

  it("an entity at identity (no rotation/scale) takes NO transform at any alpha (byte-identical)", () => {
    const world = makeWorld();
    addEntity(world, {}); // rotation 0, scale 1, prev == cur
    const { ctx, rotates, scales } = recCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    expect(rotates).toEqual([]); // never entered the transform branch
    expect(scales).toEqual([]);
  });
});

describe("render transform interpolation — composes with position", () => {
  it("rotation interpolates even while the body is also moving (full transform lerps together)", () => {
    const world = makeWorld();
    const e = new Entity({ id: "e", x: 100, y: 100, w: 10, h: 10, layer: 0, sprite: RECT });
    e.body.prevX = 80; e.body.prevY = 80; // moved this tick
    e.rotation = 1; e.body.prevRotation = 0; // and rotated this tick
    world.add(e);
    const { ctx, rects, rotates } = recCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    // position lerps 80→100 ⇒ 90 (the rect's own +0 offset), rotation lerps 0→1 ⇒ 0.5.
    expect(rects.at(-1)!).toEqual({ x: 90, y: 90 });
    expect(rotates[0]).toBeCloseTo(0.5, 6);
  });
});
