import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry } from "../src/index.js";
import { Renderer } from "../src/runtime/renderer.js";
import type { ShapeSprite } from "../src/schema/sprite.js";

/**
 * 1.8.0 — RENDER INTERPOLATION (render-only). The renderer draws each body and the camera lerped
 * between their last two tick positions (`body.prevX/prevY` → `x/y`, camera `prevX/prevY` → `x/y`) by
 * `alpha = accumulator/fixedDt`, so motion is smooth when the rAF rate doesn't divide the 60 Hz sim.
 * Pins: alpha endpoints + midpoint, the teleport-snap (a per-tick jump beyond a viewport dimension is
 * NOT interpolated), the camera scroll-base interpolation, and the alpha-1 byte-identical default. The
 * interpolation is a render-only translate — the simulation never reads it, so headless is unaffected.
 */
const RECT: ShapeSprite = { kind: "shape", shape: "rect", color: "#fff" };

/**
 * A recording 2D-context stub: tracks the cumulative translate (honoring save/restore) so a recorded
 * fillRect reports its EFFECTIVE screen position (camera + per-entity interpolation translate + the
 * entity's own x). Everything else is a no-op. This is exactly what the renderer draws to headless.
 */
function mockCtx(): { ctx: CanvasRenderingContext2D; rects: Array<{ x: number; y: number }>; translates: Array<{ x: number; y: number }> } {
  const rects: Array<{ x: number; y: number }> = [];
  const translates: Array<{ x: number; y: number }> = [];
  let tx = 0, ty = 0;
  const stack: Array<[number, number]> = [];
  const ctx = {
    save() { stack.push([tx, ty]); },
    restore() { const p = stack.pop(); if (p) { tx = p[0]; ty = p[1]; } },
    translate(x: number, y: number) { tx += x; ty += y; translates.push({ x, y }); },
    rotate() {}, scale() {},
    fillRect(x: number, y: number) { rects.push({ x: tx + x, y: ty + y }); },
    strokeRect() {}, beginPath() {}, ellipse() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    closePath() {}, fillText() {}, drawImage() {},
    set fillStyle(_v: string) {}, set strokeStyle(_v: string) {}, set lineWidth(_v: number) {},
    set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    set globalAlpha(_v: number) {}, get globalAlpha() { return 1; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, translates };
}

function makeWorld(viewport = 480): World {
  return new World({ bounds: { width: viewport, height: viewport }, config: {}, registry: createDefaultRegistry() });
}

function addRect(world: World, x: number, y: number, prevX: number, prevY: number): Entity {
  const e = new Entity({ id: "e", x, y, w: 10, h: 10, layer: 0, sprite: RECT });
  e.body.prevX = prevX;
  e.body.prevY = prevY;
  world.add(e);
  return e;
}

describe("render interpolation — per-entity", () => {
  it("alpha=1 draws at the latest sim position (byte-identical default)", () => {
    const world = makeWorld();
    addRect(world, 100, 50, 80, 40); // moved this tick
    const { ctx, rects } = mockCtx();
    new Renderer(ctx).render(world, undefined, 1);
    expect(rects.at(-1)!).toEqual({ x: 100, y: 50 });
  });

  it("alpha=0 draws at the PREVIOUS tick position", () => {
    const world = makeWorld();
    addRect(world, 100, 50, 80, 40);
    const { ctx, rects } = mockCtx();
    new Renderer(ctx).render(world, undefined, 0);
    expect(rects.at(-1)!.x).toBeCloseTo(80, 6);
    expect(rects.at(-1)!.y).toBeCloseTo(40, 6);
  });

  it("alpha=0.5 draws at the MIDPOINT between the last two ticks", () => {
    const world = makeWorld();
    addRect(world, 100, 50, 80, 40);
    const { ctx, rects } = mockCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    expect(rects.at(-1)!.x).toBeCloseTo(90, 6); // (80+100)/2
    expect(rects.at(-1)!.y).toBeCloseTo(45, 6); // (40+50)/2
  });

  it("the default alpha (omitted) is 1 — no interpolation", () => {
    const world = makeWorld();
    addRect(world, 100, 50, 80, 40);
    const { ctx, rects } = mockCtx();
    new Renderer(ctx).render(world); // no alpha
    expect(rects.at(-1)!).toEqual({ x: 100, y: 50 });
  });

  it("SNAPS (no interpolation) when the per-tick delta exceeds a viewport dimension (a teleport)", () => {
    const world = makeWorld(480);
    addRect(world, 500, 50, 5, 50); // dx=495 > 480 viewport ⇒ a wrap/respawn, not motion
    const { ctx, rects } = mockCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    expect(rects.at(-1)!.x).toBe(500); // drawn at current, NOT lerped to ~252
    expect(rects.at(-1)!.y).toBeCloseTo(50, 6); // the Y axis (delta 0) is unaffected
  });
});

describe("render interpolation — camera", () => {
  it("interpolates the scroll base between ticks (rounded to whole px)", () => {
    const world = makeWorld(480);
    world.camera = { x: 100, y: 0, width: 480, height: 480, prevX: 80, prevY: 0 };
    addRect(world, 200, 0, 200, 0); // a still entity, so only the camera moves the draw
    const { ctx, rects } = mockCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    // camera base lerps 80→100 at 0.5 = 90 (rounded), so the world shifts left by 90:
    // entity at world x=200 draws at 200 − 90 = 110.
    expect(rects.at(-1)!.x).toBe(110);
  });

  it("a camera teleport (scene warp) snaps — no streak", () => {
    const world = makeWorld(480);
    world.camera = { x: 0, y: 0, width: 480, height: 480, prevX: 1200, prevY: 0 }; // jumped back to origin
    addRect(world, 100, 0, 100, 0);
    const { ctx, rects } = mockCtx();
    new Renderer(ctx).render(world, undefined, 0.5);
    expect(rects.at(-1)!.x).toBe(100); // camera at 0 (not lerped toward 600), entity drawn at its world x
  });
});
