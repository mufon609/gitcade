import { describe, it, expect } from "vitest";
import { Game, Renderer, SceneSchema, createDefaultRegistry } from "../src/index.js";

/**
 * 1.13.0 — the additive GHOST/OVERLAY render surface: `Renderer.renderOverlay` + `Game.renderGhost` +
 * `Game.setFrameHook`. These let a stored run be composited over the LIVE frame as a translucent ghost
 * (the substrate for a ghost/time-trial race, driven by the library's `attachGhostRace`).
 *
 * The renderer is exercised against a FAKE 2D context that records its draw calls — so these assert the
 * three load-bearing render properties headlessly: (1) OVERLAY — no clear / no background fill, so the
 * live frame underneath survives; (2) SUBSET — only the filtered entities (the avatar) are drawn, never
 * the whole world; (3) CAMERA — the subset is drawn through the GIVEN camera (the LIVE camera for a
 * ghost), not the source world's own. The determinism of the live SIM is covered by the library suite
 * (snapshot byte-identity with/without a ghost) and the determinism-conformance test (unchanged here,
 * since the overlay is render-only and never touches `snapshotWorld`).
 */

/** A fake 2D context that records the calls renderOverlay makes — the headless probe for draw behavior. */
function fakeCtx(canvasW = 800, canvasH = 600) {
  const fillRects: Array<{ x: number; y: number; w: number; h: number }> = [];
  const translates: Array<{ x: number; y: number }> = [];
  let clears = 0;
  let drawImages = 0;
  // No `getTransform` ⇒ ensureOverlayLayer() returns null ⇒ the tinted path falls back to the direct
  // (untinted) draw, so a tint option is still safe headless (it just draws the subset translucent).
  const ctx = {
    canvas: { width: canvasW, height: canvasH },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    lineWidth: 1,
    save() {},
    restore() {},
    translate(x: number, y: number) {
      translates.push({ x, y });
    },
    rotate() {},
    scale() {},
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    ellipse() {},
    arc() {},
    fill() {},
    stroke() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fillRects.push({ x, y, w, h });
    },
    strokeRect() {},
    clearRect() {
      clears += 1;
    },
    fillText() {},
    drawImage() {
      drawImages += 1;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillRects, translates, clears: () => clears, drawImages: () => drawImages };
}

function rect(id: string, x: number, tag: string) {
  return {
    id,
    sprite: { kind: "shape", shape: "rect", color: "#0f0" },
    size: { w: 20, h: 20 },
    position: { x, y: 50 },
    tags: [tag],
    behaviors: [],
  };
}

/** A headless world with a `player` rect at x=100 and a `prop` rect at x=500 (distinct x ⇒ identifiable). */
function makeWorld(): Game {
  const scene = SceneSchema.parse({
    id: "track",
    size: { width: 800, height: 600 },
    entities: [rect("hero", 100, "player"), rect("prop", 500, "prop")],
    systems: [],
  });
  return new Game({ scenes: [scene], config: {}, registry: createDefaultRegistry(), canvas: null });
}

describe("Renderer.renderOverlay — SUBSET (draws only the filtered entities)", () => {
  it("with filter=hasTag('player'), draws the player rect and NOT the prop rect", () => {
    const game = makeWorld();
    const { ctx, fillRects } = fakeCtx();
    new Renderer(ctx).renderOverlay(game.world, { filter: (e) => e.hasTag("player") });

    const xs = fillRects.map((r) => r.x);
    expect(xs).toContain(100); // the player avatar
    expect(xs).not.toContain(500); // the prop is NOT re-drawn (only the subset is)
    expect(fillRects.length).toBe(1);
  });

  it("with no filter, draws every drawable entity", () => {
    const game = makeWorld();
    const { ctx, fillRects } = fakeCtx();
    new Renderer(ctx).renderOverlay(game.world, {});
    const xs = fillRects.map((r) => r.x).sort();
    expect(xs).toEqual([100, 500]);
  });
});

describe("Renderer.renderOverlay — OVERLAY (no clear, no background fill)", () => {
  it("never clears the canvas and draws no full-canvas background — the live frame survives underneath", () => {
    const game = makeWorld();
    const { ctx, fillRects, clears } = fakeCtx();
    new Renderer(ctx).renderOverlay(game.world, { filter: (e) => e.hasTag("player") });

    expect(clears()).toBe(0); // renderOverlay issues no clearRect on the live canvas
    // The only fillRect is the subset entity (20×20) — there is NO 800×600 background fill the way
    // render() draws one, so whatever the host drew before is untouched outside the ghost.
    expect(fillRects.every((r) => r.w === 20 && r.h === 20)).toBe(true);
  });

  it("is a safe no-op headless (a null context) — nothing to composite onto", () => {
    const game = makeWorld();
    expect(() => new Renderer(null).renderOverlay(game.world, {})).not.toThrow();
  });

  it("draws nothing when the subset filter excludes everything", () => {
    const game = makeWorld();
    const { ctx, fillRects, translates } = fakeCtx();
    new Renderer(ctx).renderOverlay(game.world, { filter: () => false });
    expect(fillRects.length).toBe(0);
    expect(translates.length).toBe(0); // returns before the camera translate when the subset is empty
  });
});

describe("Renderer.renderOverlay — CAMERA (draws through the given camera, not the source world's)", () => {
  it("translates the world by the PROVIDED camera (so a ghost rides the live camera)", () => {
    const game = makeWorld();
    const { ctx, translates } = fakeCtx();
    // A camera panned to (120, 40): the world translate is -round(camX), -round(camY).
    const camera = { x: 120, y: 40, width: 800, height: 600, prevX: 120, prevY: 40 };
    new Renderer(ctx).renderOverlay(game.world, { camera, filter: (e) => e.hasTag("player") });

    // The first translate is the camera basis (the entity sits at its tick position ⇒ no per-entity
    // interp translate at alpha 1), so exactly one translate of (-120, -40).
    expect(translates).toContainEqual({ x: -120, y: -40 });
  });

  it("with no camera option, uses the source world's own camera (origin ⇒ no scroll translate)", () => {
    const game = makeWorld(); // default camera at the origin
    const { ctx, translates } = fakeCtx();
    new Renderer(ctx).renderOverlay(game.world, { filter: (e) => e.hasTag("player") });
    // Origin camera + tick-position entity ⇒ no translate at all (the scrolled/interp fast paths).
    expect(translates.length).toBe(0);
  });
});

describe("Game.renderGhost — composites a ghost world through THIS game's camera", () => {
  it("draws the ghost world's subset translated by the LIVE game's camera", () => {
    // A LIVE game whose renderer holds the fake ctx (a fake canvas whose getContext returns it).
    const probe = fakeCtx();
    const liveCanvas = { width: 800, height: 600, getContext: () => probe.ctx } as unknown as HTMLCanvasElement;
    const liveScene = SceneSchema.parse({ id: "track", size: { width: 800, height: 600 }, entities: [], systems: [] });
    const live = new Game({ scenes: [liveScene], config: {}, registry: createDefaultRegistry(), canvas: liveCanvas });

    // A separate GHOST world with a player avatar at x=200.
    const ghost = makeWorld();

    // Pan the LIVE camera; renderGhost must draw the ghost through IT.
    live.world.camera.x = 60;
    live.world.camera.y = 0;
    live.world.camera.prevX = 60;
    live.world.camera.prevY = 0;
    live.renderGhost(ghost.world, { filter: (e) => e.hasTag("player") });

    expect(probe.fillRects.map((r) => r.x)).toContain(100); // the ghost avatar drew
    // Through the LIVE camera (-60), not the ghost's own. `===` so a -0 from `-Math.round(0)` (the same
    // value render() produces; identical to 0 for canvas) matches 0.
    expect(probe.translates.some((t) => t.x === -60 && t.y === 0)).toBe(true);
  });
});

describe("Game.setFrameHook — settable/clearable seam", () => {
  it("accepts a hook and clears it without throwing (the per-frame overlay seam; fired in the rAF loop)", () => {
    const game = makeWorld();
    expect(() => {
      game.setFrameHook(() => {});
      game.setFrameHook(null);
    }).not.toThrow();
  });
});
