import { describe, it, expect } from "vitest";
import { Game, SceneSchema, type Scene } from "../src/index.js";

/**
 * 1.13.0 — canvas DPR/resize handling. `devicePixelRatio` is no longer read ONCE at construction:
 * `Game.resize()` matches the backing store to the canvas's CURRENT CSS box × current DPR and scales
 * the context logical→device, so the canvas stays crisp (and never over-renders) through a browser
 * zoom, a drag to a different-density monitor, or a container resize. Render-only — headless has no
 * canvas, so determinism is untouched. (start() wires this to a ResizeObserver + a matchMedia DPR
 * watch; here we exercise the resize() math directly, which both observers call.)
 */

const SCENE: Scene = SceneSchema.parse({ id: "m", size: { width: 400, height: 300 }, entities: [], systems: [] });

/** A minimal canvas/ctx stub recording the backing-store size and the context transform `resize()` sets. */
function mockCanvas(initialRect: { width: number; height: number }) {
  let w = 0;
  let h = 0;
  let rect = { ...initialRect };
  let transform: number[] | null = null;
  const ctx = {
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      transform = [a, b, c, d, e, f];
    },
    scale() {},
    save() {},
    restore() {},
    translate() {},
  };
  const canvas = {
    get width() {
      return w;
    },
    set width(v: number) {
      w = v;
    },
    get height() {
      return h;
    },
    set height(v: number) {
      h = v;
    },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: rect.width, height: rect.height, top: 0, left: 0, right: rect.width, bottom: rect.height, x: 0, y: 0 }),
  };
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    setRect(r: { width: number; height: number }) {
      rect = { ...r };
    },
    backing: () => ({ w, h }),
    transform: () => transform,
  };
}

/** Run `fn` with `window.devicePixelRatio` stubbed (or `window` absent when `dpr` is undefined). */
function withWindow(dpr: number | undefined, fn: (win: { devicePixelRatio: number } | undefined) => void): void {
  const holder = globalThis as { window?: unknown };
  const orig = holder.window;
  const win = dpr === undefined ? undefined : { devicePixelRatio: dpr };
  holder.window = win;
  try {
    fn(win);
  } finally {
    holder.window = orig;
  }
}

function makeGame(canvas: HTMLCanvasElement | null): Game {
  return new Game({ scenes: [SCENE], config: {}, canvas, entrySceneId: "m", attachInput: false });
}

describe("canvas DPR/resize", () => {
  it("sizes the backing store to display × DPR and scales the context logical→device", () => {
    withWindow(2, () => {
      const m = mockCanvas({ width: 400, height: 300 });
      makeGame(m.canvas);
      expect(m.backing()).toEqual({ w: 800, h: 600 }); // 400css × 2dpr
      expect(m.transform()).toEqual([2, 0, 0, 2, 0, 0]); // logical 400×300 → 800×600 backing
    });
  });

  it("RE-EVALUATES DPR on resize() — the headline fix (drag to a different-density monitor)", () => {
    withWindow(2, (win) => {
      const m = mockCanvas({ width: 400, height: 300 });
      const game = makeGame(m.canvas);
      expect(m.backing()).toEqual({ w: 800, h: 600 });
      win!.devicePixelRatio = 1; // DPR drops — must not stay stuck at the construction-time 2
      game.resize();
      expect(m.backing()).toEqual({ w: 400, h: 300 });
      expect(m.transform()).toEqual([1, 0, 0, 1, 0, 0]);
    });
  });

  it("tracks the display size on resize() — crisp and no over-render at a smaller size", () => {
    withWindow(2, () => {
      const m = mockCanvas({ width: 400, height: 300 });
      const game = makeGame(m.canvas);
      m.setRect({ width: 200, height: 150 }); // container shrank
      game.resize();
      expect(m.backing()).toEqual({ w: 400, h: 300 }); // 200css × 2dpr — matches display exactly
      expect(m.transform()).toEqual([1, 0, 0, 1, 0, 0]);
    });
  });

  it("falls back to the logical scene size before the canvas is laid out (rect 0)", () => {
    withWindow(2, () => {
      const m = mockCanvas({ width: 0, height: 0 });
      makeGame(m.canvas);
      expect(m.backing()).toEqual({ w: 800, h: 600 }); // sceneW(400) × 2dpr
    });
  });

  it("defaults DPR to 1 when there is no window", () => {
    withWindow(undefined, () => {
      const m = mockCanvas({ width: 400, height: 300 });
      makeGame(m.canvas);
      expect(m.backing()).toEqual({ w: 400, h: 300 }); // 400 × 1
    });
  });

  it("resize() is a safe no-op for a headless (canvas-null) game", () => {
    withWindow(2, () => {
      const game = makeGame(null);
      expect(() => game.resize()).not.toThrow();
    });
  });
});
