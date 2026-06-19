import { describe, it, expect } from "vitest";
import { World, Entity, createDefaultRegistry } from "../src/index.js";
import { Renderer } from "../src/runtime/renderer.js";
import type { ShapeSprite } from "../src/schema/sprite.js";
import type { Tilemap } from "../src/schema/scene.js";

/**
 * 1.10.1 — VIEWPORT (camera-rect) CULLING (render-only). The renderer no longer redraws the whole
 * tilemap + every entity each frame: it iterates only the tile cells intersecting the viewport cull
 * rect, and skips an entity whose conservative drawn AABB is fully outside it. Output is PIXEL-IDENTICAL
 * — culling only drops draw calls for geometry off-screen (a SUPERSET test), never one with a visible
 * pixel. Pins: (a) on a large SCROLLED map the drawn tile/entity set equals an independent naive
 * visible-set reference and far-off-screen geometry is skipped; (b) ZERO popping at the seam — an entity
 * straddling the edge, a rotated+scaled entity whose transformed extent reaches in (the plain box would
 * miss), mid-interpolation (alpha 0.5), and under camera shake all still draw; and the non-scrolling
 * (world == viewport) scene culls nothing. All of it lives behind `if (!ctx) return`, so the headless
 * sim/validator path is untouched.
 */
const RECT: ShapeSprite = { kind: "shape", shape: "rect", color: "#fff" };

/**
 * A recording 2D-context stub that captures the RAW fillRect/drawImage args (NOT the translated screen
 * position): a tile fills at world `(col·ts, row·ts)` and a rect entity fills at its world `(e.x, e.y)`
 * (the camera/interpolation translates live in the ctx state, not the args), so the raw `x` identifies
 * the cell/entity directly. The cumulative translate is still tracked for save/restore balance. Tiles,
 * entities, and the background are told apart by their `w`/`h` (tile == tileSize, background == viewport).
 */
function cullCtx() {
  const fills: Array<{ x: number; y: number; w: number; h: number }> = [];
  let tx = 0,
    ty = 0;
  const stack: Array<[number, number]> = [];
  const ctx = {
    save() {
      stack.push([tx, ty]);
    },
    restore() {
      const p = stack.pop();
      if (p) {
        tx = p[0];
        ty = p[1];
      }
    },
    translate(x: number, y: number) {
      tx += x;
      ty += y;
    },
    rotate() {},
    scale() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h });
    },
    strokeRect() {},
    beginPath() {},
    ellipse() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fillText() {},
    drawImage() {},
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    set globalAlpha(_v: number) {},
    get globalAlpha() {
      return 1;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fills };
}

/** A world whose bounds exceed the viewport, with the camera scrolled to `camX` (the scrolling case). */
function scrollWorld(camX: number): World {
  const world = new World({ bounds: { width: 4000, height: 600 }, config: {}, registry: createDefaultRegistry() });
  world.camera = { x: camX, y: 0, width: 800, height: 600 };
  return world;
}

/** A world larger than its `vw×vh` viewport with the camera at the ORIGIN (camX==camY==0, but world > viewport). */
function originWorld(vw: number, vh: number): World {
  const world = new World({ bounds: { width: 4000, height: 1200 }, config: {}, registry: createDefaultRegistry() });
  world.camera = { x: 0, y: 0, width: vw, height: vh };
  return world;
}

/** Add a rect-shape entity with explicit transform / prev-tick history (defaults: identity, prev == cur). */
function addShape(
  world: World,
  opts: { x: number; y: number; w: number; h: number; prevX?: number; prevY?: number; rotation?: number; scaleX?: number; scaleY?: number; stroke?: string; strokeWidth?: number },
): Entity {
  const sprite: ShapeSprite = { kind: "shape", shape: "rect", color: "#fff", ...(opts.stroke ? { stroke: opts.stroke, strokeWidth: opts.strokeWidth } : {}) };
  const e = new Entity({ id: `e${world.entities.length}`, x: opts.x, y: opts.y, w: opts.w, h: opts.h, layer: 0, sprite });
  e.body.prevX = opts.prevX ?? opts.x;
  e.body.prevY = opts.prevY ?? opts.y;
  if (opts.rotation != null) {
    e.rotation = opts.rotation;
    e.body.prevRotation = opts.rotation;
  }
  if (opts.scaleX != null) {
    e.scaleX = opts.scaleX;
    e.body.prevScaleX = opts.scaleX;
  }
  if (opts.scaleY != null) {
    e.scaleY = opts.scaleY;
    e.body.prevScaleY = opts.scaleY;
  }
  world.add(e);
  return e;
}

describe("1.10.1 viewport culling — tilemap (large scrolled map)", () => {
  it("draws exactly the visible tile window, equal to a naive full-scan visible set, and skips off-screen cells", () => {
    const ts = 32,
      cols = 200,
      rows = 10; // a 6400×320 world — 32× the 800-wide viewport
    const tiles = new Array(cols * rows).fill(-1);
    for (let c = 0; c < cols; c++) tiles[c] = 1; // a full floor on row 0 ⇒ one solid tile per column
    const world = new World({ bounds: { width: cols * ts, height: rows * ts }, config: {}, registry: createDefaultRegistry() });
    world.tilemap = { tileSize: ts, cols, rows, tiles, properties: { "1": { solid: true, color: "#246" } } } as Tilemap;
    const camX = 3200;
    world.camera = { x: camX, y: 0, width: 800, height: rows * ts };

    const { ctx, fills } = cullCtx();
    new Renderer(ctx).render(world);
    const drawnCols = new Set(fills.filter((f) => f.w === ts && f.h === ts).map((f) => f.x / ts));

    // Independent NAIVE reference: every non-empty cell whose SCREEN rect intersects the viewport.
    const naiveVisible = new Set<number>();
    for (let c = 0; c < cols; c++) {
      const sx = c * ts - Math.round(camX); // the cell's left edge in screen space
      if (sx + ts > 0 && sx < 800) naiveVisible.add(c);
    }
    expect(naiveVisible.size).toBe(25); // viewport world-x ∈ [3200,4000] ⇒ cols 100..124

    // ZERO popping: every naively-visible cell IS drawn.
    for (const c of naiveVisible) expect(drawnCols.has(c)).toBe(true);
    // Culling effective: nothing outside the visible band's ±1-cell halo (the CULL_MARGIN + floor/ceil slop).
    const lo = Math.min(...naiveVisible),
      hi = Math.max(...naiveVisible);
    for (const c of drawnCols) expect(c >= lo - 1 && c <= hi + 1).toBe(true);
    // ...and a tiny fraction of the 200-col map, not the whole thing (the actual win).
    expect(drawnCols.size).toBeLessThan(cols / 5);
    for (const c of [0, 50, 98, 130, 199]) expect(drawnCols.has(c)).toBe(false); // far-off-screen cols skipped
  });
});

describe("1.10.1 viewport culling — entities (large scrolled map)", () => {
  it("draws exactly the on-screen entities (== naive visible set) and skips the far-off-screen ones", () => {
    const world = scrollWorld(3000); // viewport world-x ∈ [3000,3800]; bounds 4000 wide (entities span the strip)
    const xs = [0, 1000, 2000, 3100, 3400, 3700, 4500, 5500, 6390];
    for (const x of xs) addShape(world, { x, y: 150, w: 20, h: 20 });

    const { ctx, fills } = cullCtx();
    new Renderer(ctx).render(world);
    const drawnXs = new Set(fills.filter((f) => f.w === 20 && f.h === 20).map((f) => f.x));

    // Naive reference: an entity whose box intersects the viewport in screen space.
    const naiveVisible = new Set(xs.filter((x) => x + 20 > Math.round(3000) && x < Math.round(3000) + 800));
    expect(naiveVisible).toEqual(new Set([3100, 3400, 3700]));
    expect(drawnXs).toEqual(naiveVisible); // drawn set == visible set, exactly (none near a seam here)
  });
});

describe("1.10.1 viewport culling — zero popping at the seam", () => {
  it("draws an entity straddling the viewport edge, skips one fully past it", () => {
    const world = scrollWorld(1000); // right edge at world 1800
    addShape(world, { x: 1790, y: 100, w: 40, h: 40 }); // [1790,1830] straddles 1800
    addShape(world, { x: 2000, y: 100, w: 24, h: 24 }); // [2000,2024] fully past the edge
    const { ctx, fills } = cullCtx();
    new Renderer(ctx).render(world);
    expect(fills.some((f) => f.w === 40)).toBe(true); // straddler drawn — no popping at the seam
    expect(fills.some((f) => f.w === 24)).toBe(false); // fully-outside entity culled
  });

  it("draws a rotated + scaled entity whose transformed extent reaches in (the plain box alone would miss)", () => {
    const world = originWorld(800, 600); // camera at origin, viewport 800×600, world larger
    // Plain box [820,860] is fully RIGHT of the 800 edge, but scaled 3× about its center it spans
    // [780,900] ⇒ 20px on-screen. A w/h-only test would WRONGLY cull it; the circumscribed radius keeps it.
    addShape(world, { x: 820, y: 280, w: 40, h: 40, rotation: Math.PI / 4, scaleX: 3, scaleY: 3 });
    // Control: identical off-screen x, NO transform ⇒ correctly culled (so the radius is what saves the first).
    addShape(world, { x: 820, y: 360, w: 28, h: 28 });
    const { ctx, fills } = cullCtx();
    new Renderer(ctx).render(world);
    expect(fills.some((f) => f.w === 40)).toBe(true); // transformed extent reaches the viewport ⇒ drawn
    expect(fills.some((f) => f.w === 28)).toBe(false); // same position, un-transformed ⇒ culled
  });

  it("uses the INTERPOLATED position: an entity off-screen at cur but lerping through the edge draws at alpha 0.5", () => {
    const world = originWorld(800, 600);
    // cur x=900 is fully off-screen [900,920]; prev x=700 is on-screen. At alpha 0.5 the draw lerps to
    // x=800 (straddling the edge) ⇒ must draw. At alpha 1 (cur) it's off-screen ⇒ culled.
    addShape(world, { x: 900, y: 300, w: 20, h: 20, prevX: 700, prevY: 300 });
    const half = cullCtx();
    new Renderer(half.ctx).render(world, undefined, 0.5);
    const full = cullCtx();
    new Renderer(full.ctx).render(world, undefined, 1);
    expect(half.fills.some((f) => f.w === 20)).toBe(true); // interpolated into view ⇒ drawn
    expect(full.fills.some((f) => f.w === 20)).toBe(false); // at cur it is off-screen ⇒ culled
  });

  it("accounts for camera shake: an off-edge entity that shake pulls into view draws", () => {
    const base = originWorld(800, 600);
    addShape(base, { x: 820, y: 300, w: 20, h: 20 }); // [820,840] off-screen right (screen 820 > 800)
    const noShake = cullCtx();
    new Renderer(noShake.ctx).render(base);
    expect(noShake.fills.some((f) => f.w === 20)).toBe(false); // off-screen, no shake ⇒ culled

    const shaken = originWorld(800, 600);
    addShape(shaken, { x: 820, y: 300, w: 20, h: 20 });
    shaken.camera.shakeX = 30; // the view jolts right 30px ⇒ world 820 lands at screen 790 (on-screen)
    const rec = cullCtx();
    new Renderer(rec.ctx).render(shaken);
    expect(rec.fills.some((f) => f.w === 20)).toBe(true); // shake brought it on-screen ⇒ drawn (no popping)
  });

  it("always draws TEXT (its extent isn't bounded by the entity box) even far outside the viewport", () => {
    const world = scrollWorld(3000); // viewport world-x ∈ [3000,3800]
    const label = new Entity({ id: "label", x: 50, y: 50, w: 4, h: 4, layer: 0, sprite: { kind: "text", text: "HP", font: "16px monospace", color: "#fff", align: "left" } });
    label.body.prevX = 50;
    label.body.prevY = 50;
    world.add(label);
    // A shape at the same far-off-screen x IS culled — proving it's the text exemption, not the position.
    addShape(world, { x: 50, y: 120, w: 18, h: 18 });
    let drewText = false;
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      ellipse() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fillText() {
        drewText = true;
      },
      drawImage() {},
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
      set globalAlpha(_v: number) {},
      get globalAlpha() {
        return 1;
      },
    } as unknown as CanvasRenderingContext2D;
    new Renderer(ctx).render(world);
    expect(drewText).toBe(true); // text never culled (refuse to cull what the box can't bound)
  });
});

describe("1.10.1 viewport culling — non-scrolling scene is byte-identical", () => {
  it("a world == viewport scene at the camera origin culls nothing (every cell + entity still drawn)", () => {
    const ts = 32,
      cols = 10,
      rows = 10; // world 320×320 == the default viewport
    const tiles = new Array(cols * rows).fill(1); // every cell filled
    const world = new World({ bounds: { width: cols * ts, height: rows * ts }, config: {}, registry: createDefaultRegistry() });
    world.tilemap = { tileSize: ts, cols, rows, tiles, properties: { "1": { solid: true } } } as Tilemap;
    // camera defaults to the full bounds at the origin (no override) — the pre-0.7 byte-identical path.
    for (const x of [10, 100, 300]) addShape(world, { x, y: 100, w: 16, h: 16 });

    const { ctx, fills } = cullCtx();
    new Renderer(ctx).render(world);
    expect(fills.filter((f) => f.w === ts && f.h === ts).length).toBe(cols * rows); // all 100 cells drawn
    expect(fills.filter((f) => f.w === 16).length).toBe(3); // all 3 entities drawn
  });
});
