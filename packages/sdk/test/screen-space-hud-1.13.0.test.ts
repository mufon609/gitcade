import { describe, it, expect } from "vitest";
import { World, Entity, Game, SceneSchema, createDefaultRegistry, assertDeterministic, snapshotWorld } from "../src/index.js";
import { Renderer } from "../src/runtime/renderer.js";
import type { ShapeSprite } from "../src/schema/sprite.js";

/**
 * 1.13.0 — SCREEN-SPACE RENDER LAYER (additive, render-only). An entity with `screen:true` draws in
 * SCREEN space — fixed on the canvas, NOT panned by the follow-camera — so a data-authored HUD
 * (a `text` score, a `hud-bar`) stays put while the world scrolls, instead of scrolling off the
 * level. It is drawn AFTER the world's camera `ctx.restore()`, in canvas coordinates, un-culled and
 * un-interpolated, sorted by `layer` then `zIndex`, and excluded from the world drawList (never drawn
 * twice). Pins: (a) a world entity is camera-offset while a screen entity draws at its raw canvas
 * position; (b) a screen entity escapes the viewport cull; (c) screen entities draw AFTER all world
 * entities and are layer/zIndex sorted; (d) the screen pass honors visible / sprite-none like the
 * world pass; (e) DETERMINISM — `screen` is render-only, NOT a snapshot field, and a scene that uses
 * it stays byte-deterministic; (f) FAST PATH — a scene with no screen entity is byte-identical to
 * before this layer (the world draws are unperturbed and no screen pass runs). All of it lives behind
 * `if (!ctx) return`, so the headless sim / validator path is untouched.
 */

/**
 * A recording 2D-context stub that captures the ordered op log AND each draw's EFFECTIVE screen
 * position (the raw arg plus the cumulative, save/restore-tracked translate). A WORLD entity's fill
 * lands camera-offset (effective = raw − cam); a SCREEN entity's fill lands at its raw position
 * (drawn after the camera restore, with no translate active) — so `effective === raw` cleanly
 * identifies a screen-space draw. Background / entities are told apart by their `w`/`h`.
 */
function recordCtx(): { ctx: CanvasRenderingContext2D; ops: Array<{ op: string; x?: number; y?: number; w?: number; h?: number; ex?: number; ey?: number }> } {
  const ops: Array<{ op: string; x?: number; y?: number; w?: number; h?: number; ex?: number; ey?: number }> = [];
  let tx = 0,
    ty = 0;
  const stack: Array<[number, number]> = [];
  const ctx = {
    save() {
      ops.push({ op: "save" });
      stack.push([tx, ty]);
    },
    restore() {
      ops.push({ op: "restore" });
      const p = stack.pop();
      if (p) {
        tx = p[0];
        ty = p[1];
      }
    },
    translate(x: number, y: number) {
      ops.push({ op: "translate", x, y });
      tx += x;
      ty += y;
    },
    rotate() {
      ops.push({ op: "rotate" });
    },
    scale() {
      ops.push({ op: "scale" });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ op: "fillRect", x, y, w, h, ex: tx + x, ey: ty + y });
    },
    strokeRect() {},
    beginPath() {},
    ellipse() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fillText(_t: string, x: number, y: number) {
      ops.push({ op: "fillText", x, y, ex: tx + x, ey: ty + y });
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
  return { ctx, ops };
}

/** A world larger than its 800×600 viewport, scrolled to `(camX, camY)` (the scrolling case). */
function scrollWorld(camX: number, camY = 0): World {
  const world = new World({ bounds: { width: 4000, height: 1200 }, config: {}, registry: createDefaultRegistry() });
  world.camera = { x: camX, y: camY, width: 800, height: 600 };
  return world;
}

/** Add a rect-shape entity (prev == cur, so no render interpolation), optionally `screen:true`. */
function addRect(
  world: World,
  opts: { x: number; y: number; w: number; h: number; screen?: boolean; layer?: number; zIndex?: number; color?: string },
): Entity {
  const sprite: ShapeSprite = { kind: "shape", shape: "rect", color: opts.color ?? "#fff" };
  const e = new Entity({
    id: `e${world.entities.length}`,
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    layer: opts.layer ?? 0,
    zIndex: opts.zIndex,
    screen: opts.screen,
    sprite,
  });
  e.body.prevX = opts.x;
  e.body.prevY = opts.y;
  world.add(e);
  return e;
}

describe("1.13.0 screen-space HUD — fixed under a scrolling camera", () => {
  it("a world entity draws camera-offset; a screen:true entity draws at its raw canvas position", () => {
    const world = scrollWorld(1000); // camera scrolled right 1000px
    addRect(world, { x: 1200, y: 100, w: 20, h: 20 }); // WORLD entity
    addRect(world, { x: 50, y: 40, w: 30, h: 30, screen: true }); // SCREEN HUD entity

    const { ctx, ops } = recordCtx();
    new Renderer(ctx).render(world);

    const worldFill = ops.find((o) => o.op === "fillRect" && o.w === 20)!;
    const screenFill = ops.find((o) => o.op === "fillRect" && o.w === 30)!;

    // World entity: panned by the camera ⇒ effective screen x = 1200 − 1000 = 200 (≠ its raw 1200).
    expect(worldFill.ex).toBe(200);
    expect(worldFill.ey).toBe(100);
    expect(worldFill.ex).not.toBe(worldFill.x);

    // Screen entity: NOT panned ⇒ drawn at its raw canvas coords (50,40), the camera ignored.
    expect(screenFill.ex).toBe(50);
    expect(screenFill.ey).toBe(40);
    expect(screenFill.ex).toBe(screenFill.x); // effective == raw ⇒ no camera offset applied
  });

  it("a screen entity escapes the viewport cull (would be off-screen as a world entity, still drawn)", () => {
    // Camera far down the world: viewport world-x ∈ [3000,3800]. A world entity at canvas (20,20)
    // would be far left of the viewport and culled; as a SCREEN entity it is never culled and stays
    // fixed on the canvas.
    const world = scrollWorld(3000);
    addRect(world, { x: 20, y: 20, w: 24, h: 24, screen: true });
    addRect(world, { x: 20, y: 80, w: 25, h: 25 }); // control: same low x as a WORLD entity ⇒ culled

    const { ctx, ops } = recordCtx();
    new Renderer(ctx).render(world);

    const screenFill = ops.find((o) => o.op === "fillRect" && o.w === 24);
    expect(screenFill).toBeDefined();
    expect(screenFill!.ex).toBe(20); // fixed on the canvas regardless of how far the camera scrolled
    expect(ops.some((o) => o.op === "fillRect" && o.w === 25)).toBe(false); // the world control IS culled
  });
});

describe("1.13.0 screen-space HUD — drawn after the world, layer/zIndex sorted", () => {
  it("every screen entity is drawn AFTER all world entities (and after the camera restore)", () => {
    const world = scrollWorld(500);
    addRect(world, { x: 600, y: 100, w: 20, h: 20 }); // world
    addRect(world, { x: 700, y: 200, w: 22, h: 22 }); // world
    addRect(world, { x: 10, y: 10, w: 30, h: 30, screen: true }); // screen

    const { ctx, ops } = recordCtx();
    new Renderer(ctx).render(world);

    const lastWorld = Math.max(
      ops.findIndex((o) => o.op === "fillRect" && o.w === 20),
      ops.findIndex((o) => o.op === "fillRect" && o.w === 22),
    );
    const screenIdx = ops.findIndex((o) => o.op === "fillRect" && o.w === 30);
    expect(screenIdx).toBeGreaterThan(lastWorld); // screen fill comes after both world fills
    expect(ops[screenIdx].ex).toBe(ops[screenIdx].x); // ...and after the camera restore (no pan applied)
  });

  it("screen entities draw sorted by layer, then zIndex, within the screen pass", () => {
    const world = scrollWorld(0); // ordering needs no scroll
    // Added out of final order; expected draw order is layer asc, then zIndex asc.
    addRect(world, { x: 0, y: 0, w: 31, h: 31, screen: true, layer: 2 }); // layer 2 (zIndex defaults to 2)
    addRect(world, { x: 0, y: 0, w: 32, h: 32, screen: true, layer: 0, zIndex: 5 });
    addRect(world, { x: 0, y: 0, w: 33, h: 33, screen: true, layer: 0, zIndex: 1 });

    const { ctx, ops } = recordCtx();
    new Renderer(ctx).render(world);

    const order = ops.filter((o) => o.op === "fillRect" && (o.w === 31 || o.w === 32 || o.w === 33)).map((o) => o.w);
    expect(order).toEqual([33, 32, 31]); // layer0/z1, then layer0/z5, then layer2
  });

  it("the screen pass honors visible / sprite-none exactly like the world pass", () => {
    const world = scrollWorld(0);
    const hidden = addRect(world, { x: 0, y: 0, w: 40, h: 40, screen: true });
    hidden.visible = false; // a hidden screen entity must be skipped
    addRect(world, { x: 0, y: 0, w: 41, h: 41, screen: true }); // visible control

    const { ctx, ops } = recordCtx();
    new Renderer(ctx).render(world);

    expect(ops.some((o) => o.op === "fillRect" && o.w === 40)).toBe(false); // hidden ⇒ skipped
    expect(ops.some((o) => o.op === "fillRect" && o.w === 41)).toBe(true); // visible ⇒ drawn
  });
});

describe("1.13.0 screen-space HUD — determinism (render-only, snapshot-free)", () => {
  const sceneGame = (rng: () => number): Game => {
    const scene = SceneSchema.parse({
      id: "s",
      size: { width: 800, height: 600 },
      world: { width: 4000, height: 600 },
      entities: [
        {
          id: "mover",
          sprite: { kind: "shape", shape: "rect", color: "#fff" },
          size: { w: 20, h: 20 },
          position: { x: 0, y: 100 },
          behaviors: [{ type: "velocity", params: { vx: 60, vy: 0 } }],
        },
        {
          id: "hud",
          screen: true, // a fixed HUD label in the same scene as a moving world entity
          sprite: { kind: "text", text: "SCORE", font: "16px monospace", color: "#fff", align: "left" },
          size: { w: 80, h: 20 },
          position: { x: 10, y: 10 },
        },
      ],
      systems: [],
    });
    return new Game({ scenes: [scene], config: {}, registry: createDefaultRegistry(), rng, canvas: null });
  };

  it("a scene containing a screen:true entity is byte-deterministic across two runs", () => {
    expect(() => assertDeterministic(sceneGame, { frames: 60 })).not.toThrow();
  });

  it("`screen` is NOT part of the deterministic snapshot (render-only field)", () => {
    const world = new World({ bounds: { width: 800, height: 600 }, config: {}, registry: createDefaultRegistry() });
    const hud = new Entity({
      id: "hud",
      x: 10,
      y: 10,
      w: 80,
      h: 20,
      layer: 0,
      screen: true,
      sprite: { kind: "text", text: "HP", font: "16px monospace", color: "#fff", align: "left" },
    });
    world.add(hud);
    expect(hud.screen).toBe(true); // the flag IS set on the runtime entity
    expect(snapshotWorld(world)).not.toContain("screen"); // ...but never reaches the snapshot
  });
});

describe("1.13.0 screen-space HUD — fast path (no screen entity ⇒ byte-identical)", () => {
  it("with NO screen entity, every entity draws camera-offset and no screen-space pass runs", () => {
    const world = scrollWorld(1000);
    addRect(world, { x: 1200, y: 100, w: 20, h: 20 });
    addRect(world, { x: 1400, y: 150, w: 22, h: 22 });

    const { ctx, ops } = recordCtx();
    new Renderer(ctx).render(world);

    const entityFills = ops.filter((o) => o.op === "fillRect" && (o.w === 20 || o.w === 22));
    expect(entityFills.length).toBe(2);
    for (const f of entityFills) {
      expect(f.ex).toBe(f.x! - 1000); // panned by the camera, exactly as before this layer
      expect(f.ex).not.toBe(f.x); // ...so nothing was drawn in screen space (the screen pass never ran)
    }
    expect(ops.filter((o) => o.op === "save").length).toBe(ops.filter((o) => o.op === "restore").length); // balanced
  });

  it("adding a screen entity leaves the WORLD draws byte-identical (drawList unperturbed)", () => {
    // World entities alone...
    const a = scrollWorld(800);
    addRect(a, { x: 1000, y: 100, w: 20, h: 20 });
    addRect(a, { x: 1100, y: 120, w: 20, h: 20 });
    const recA = recordCtx();
    new Renderer(recA.ctx).render(a);

    // ...then the SAME world entities PLUS a screen HUD: the world draws must be identical (same
    // camera-offset fills, same order); only an extra screen fill appears, at raw canvas coords.
    const b = scrollWorld(800);
    addRect(b, { x: 1000, y: 100, w: 20, h: 20 });
    addRect(b, { x: 1100, y: 120, w: 20, h: 20 });
    addRect(b, { x: 5, y: 5, w: 30, h: 30, screen: true });
    const recB = recordCtx();
    new Renderer(recB.ctx).render(b);

    const worldFills = (ops: typeof recA.ops): Array<{ ex?: number; ey?: number }> =>
      ops.filter((o) => o.op === "fillRect" && o.w === 20).map((o) => ({ ex: o.ex, ey: o.ey }));
    expect(worldFills(recB.ops)).toEqual(worldFills(recA.ops)); // world path unchanged by the screen entity

    const screenFill = recB.ops.find((o) => o.op === "fillRect" && o.w === 30)!;
    expect(screenFill.ex).toBe(5); // the lone extra fill is the screen HUD, at its raw canvas position
  });
});
