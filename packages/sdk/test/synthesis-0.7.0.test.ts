import { describe, it, expect } from "vitest";
import {
  SceneSchema,
  resolveSceneInheritance,
  World,
  Game,
  Renderer,
  Entity,
  type Scene,
  createDefaultRegistry,
} from "../src/index.js";

/**
 * 0.7.0 — camera + world/viewport decouple (INDIE-ROADMAP Tier-0 item 0.1).
 *
 * `scene.world` separates the simulation bounds from the viewport (`scene.size`);
 * `world.camera` is the window the renderer pans across it. Everything is additive:
 * a scene with no `world`/camera-move renders byte-identically to pre-0.7.
 */

const DEFAULTS = { config: {} };

describe("0.7.0 schema — scene.world + solid tile flag", () => {
  it("parses an optional `world` larger than the viewport", () => {
    const s = SceneSchema.parse({
      id: "lvl",
      size: { width: 800, height: 600 },
      world: { width: 3200, height: 600 },
      entities: [],
      systems: [],
    });
    expect(s.world).toEqual({ width: 3200, height: 600 });
  });

  it("leaves `world` undefined when absent (pre-0.7 scenes unchanged)", () => {
    const s = SceneSchema.parse({ id: "s", entities: [], systems: [] });
    expect(s.world).toBeUndefined();
  });

  it("accepts a `solid` tile property flag", () => {
    const s = SceneSchema.parse({
      id: "s",
      entities: [],
      systems: [],
      tilemap: { tileSize: 16, cols: 2, rows: 1, tiles: [0, 1], properties: { "1": { solid: true } } },
    });
    expect(s.tilemap?.properties?.["1"]?.solid).toBe(true);
  });
});

describe("0.7.0 inheritance — world bounds merge", () => {
  it("a child inherits the base's `world`, and can override it", () => {
    const base = SceneSchema.parse({ id: "shell", size: { width: 800, height: 600 }, world: { width: 4000, height: 600 } });
    const lvl1 = SceneSchema.parse({ id: "l1", extends: "shell" });
    const lvl2 = SceneSchema.parse({ id: "l2", extends: "shell", world: { width: 8000, height: 600 } });
    const [, r1, r2] = resolveSceneInheritance([base, lvl1, lvl2]);
    expect(r1.world).toEqual({ width: 4000, height: 600 }); // inherited
    expect(r2.world).toEqual({ width: 8000, height: 600 }); // overridden
  });
});

describe("0.7.0 World.camera", () => {
  it("defaults the viewport to the full bounds at the origin", () => {
    const world = new World({ bounds: { width: 800, height: 600 }, config: {}, registry: createDefaultRegistry() });
    expect(world.camera).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});

function scene(extra: Partial<Scene>): Scene {
  return SceneSchema.parse({ id: "s", entities: [], systems: [], ...extra });
}

describe("0.7.0 Game — per-scene bounds vs viewport", () => {
  it("decouples world bounds (sim) from the camera viewport when `world` is set", () => {
    const game = new Game({ scenes: [scene({ size: { width: 800, height: 600 }, world: { width: 3200, height: 600 } })], ...DEFAULTS });
    expect(game.world.bounds).toEqual({ width: 3200, height: 600 }); // sim area
    expect(game.world.camera.width).toBe(800); // viewport = size
    expect(game.world.camera.height).toBe(600);
    expect(game.world.camera.x).toBe(0);
  });

  it("with no `world`, bounds == viewport (byte-identical to pre-0.7)", () => {
    const game = new Game({ scenes: [scene({ size: { width: 480, height: 320 } })], ...DEFAULTS });
    expect(game.world.bounds).toEqual({ width: 480, height: 320 });
    expect(game.world.camera).toEqual({ x: 0, y: 0, width: 480, height: 320 });
  });
});

/** A 2D-context stand-in that records translate + fillRect calls (the bits the camera path touches). */
function recordingCtx() {
  const calls: { translate: Array<[number, number]>; fillRects: Array<[number, number, number, number]>; saves: number; restores: number } = {
    translate: [],
    fillRects: [],
    saves: 0,
    restores: 0,
  };
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "top",
    save: () => void (calls.saves += 1),
    restore: () => void (calls.restores += 1),
    translate: (x: number, y: number) => void calls.translate.push([x, y]),
    rotate: () => {},
    scale: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => void calls.fillRects.push([x, y, w, h]),
    strokeRect: () => {},
    beginPath: () => {},
    ellipse: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    drawImage: () => {},
    fillText: () => {},
  };
  return { ctx, calls };
}

describe("0.7.0 Renderer — camera transform", () => {
  function worldWithBox(camX: number, camY: number) {
    const world = new World({ bounds: { width: 3200, height: 600 }, config: {}, registry: createDefaultRegistry() });
    world.camera = { x: camX, y: camY, width: 800, height: 600 };
    world.add(
      Object.assign(Object.create(null), {
        x: 100, y: 100, w: 16, h: 16, cx: 108, cy: 108, layer: 0, zIndex: 0, rotation: 0, scaleX: 1, scaleY: 1,
        alive: true, sprite: { kind: "shape", shape: "rect", color: "#fff" },
      }) as never,
    );
    return world;
  }

  it("translates by the negated, rounded camera position when scrolled", () => {
    const { ctx, calls } = recordingCtx();
    new Renderer(ctx as never).render(worldWithBox(640.6, 120.2));
    expect(calls.translate).toContainEqual([-641, -120]); // -round(640.6), -round(120.2)
    // First fillRect is the background, drawn in SCREEN space at the viewport size.
    expect(calls.fillRects[0]).toEqual([0, 0, 800, 600]);
  });

  it("does NOT translate at the camera origin (pre-0.7 path is byte-identical)", () => {
    const { ctx, calls } = recordingCtx();
    new Renderer(ctx as never).render(worldWithBox(0, 0));
    expect(calls.translate).toHaveLength(0);
  });
});

/** A ctx stub that records the `globalAlpha` IN EFFECT at each fillRect (so we can assert
 *  the entity drew faded), plus whether a fillRect happened at all (drawn vs skipped). */
function alphaCtx() {
  const fills: Array<{ alpha: number }> = [];
  const stack: number[] = []; // emulate canvas save/restore of globalAlpha
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "top",
    save() {
      stack.push(ctx.globalAlpha);
    },
    restore() {
      const v = stack.pop();
      if (v !== undefined) ctx.globalAlpha = v;
    },
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    fillRect() {
      fills.push({ alpha: ctx.globalAlpha });
    },
    strokeRect: () => {},
    beginPath: () => {},
    ellipse: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    drawImage: () => {},
    fillText: () => {},
  };
  return { ctx, fills };
}

describe("0.7.0 Renderer — opacity + visibility (declared-but-ignored slots)", () => {
  function boxWorld(over: { opacity?: number; visible?: boolean }) {
    const world = new World({ bounds: { width: 200, height: 200 }, config: {}, registry: createDefaultRegistry() });
    world.add(
      new Entity({ id: "b", x: 10, y: 10, w: 16, h: 16, layer: 0, sprite: { kind: "shape", shape: "rect", color: "#fff" }, ...over }),
    );
    return world;
  }

  it("applies entity.opacity as globalAlpha while drawing", () => {
    const { ctx, fills } = alphaCtx();
    new Renderer(ctx as never).render(boxWorld({ opacity: 0.4 }), "#000");
    const shapeFill = fills[fills.length - 1]; // last fillRect is the entity (background is first)
    expect(shapeFill.alpha).toBeCloseTo(0.4, 6);
    expect(ctx.globalAlpha).toBe(1); // restored after the entity
  });

  it("draws fully opaque (globalAlpha 1) by default — byte-identical to pre-0.7", () => {
    const { ctx, fills } = alphaCtx();
    new Renderer(ctx as never).render(boxWorld({}), "#000");
    expect(fills[fills.length - 1].alpha).toBe(1);
  });

  it("skips an entity with visible:false (retires the off-screen-park bandaid)", () => {
    const { ctx, fills } = alphaCtx();
    new Renderer(ctx as never).render(boxWorld({ visible: false }), "#000");
    expect(fills).toHaveLength(1); // only the background fill; the entity was skipped
  });
});
