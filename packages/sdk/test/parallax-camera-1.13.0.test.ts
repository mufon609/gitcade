import { describe, it, expect, beforeAll } from "vitest";
import { World, Renderer, createDefaultRegistry, BackgroundSchema } from "../src/index.js";

/**
 * Camera-coupled parallax (sdk 1.13.0, additive render-only): a `background.layers` layer may carry
 * `parallaxX`/`parallaxY` factors so it offsets by `-camera · parallax` and tracks the view — in ADDITION
 * to the existing `scroll · time` drift. These tests pin the new coupling AND prove the legacy drift path
 * is untouched (factor 0 / camera at origin ⇒ byte-identical to before the field).
 */

/** Browser-only Image stub with a fixed natural size, so tile math is predictable headlessly. */
class StubImage {
  src = "";
  complete = true;
  naturalWidth = 800;
  naturalHeight = 600;
}

/** Mock 2D context recording the x of every drawImage (the only call the parallax path makes). */
function makeCtx() {
  const xs: number[] = [];
  const ctx = {
    fillStyle: "",
    save() {},
    restore() {},
    translate() {}, // a panned camera triggers the world translate — must exist, value irrelevant here
    fillRect() {},
    drawImage(...args: unknown[]) {
      xs.push(args[1] as number); // drawImage(img, x, y, w, h) → args[1] is x
    },
  };
  return { ctx, xs };
}

function makeWorld(): World {
  return new World({ bounds: { width: 800, height: 600 }, config: {}, registry: createDefaultRegistry() });
}

describe("renderer parallax camera coupling (1.13.0)", () => {
  beforeAll(() => {
    (globalThis as unknown as { Image: unknown }).Image = StubImage;
  });

  it("offsets a coupled layer by -camX * parallaxX as the camera pans forward", () => {
    const { ctx, xs } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    w.camera.x = 100; // camera panned right by 100 world px
    w.time = 5; // proves time is irrelevant to coupling when scrollX is 0
    r.render(w, { color: "#000", layers: [{ src: "bg.png", scrollX: 0, scrollY: 0, parallaxX: 0.5, parallaxY: 0 }] });
    // leftmost tile origin = -camX * parallaxX = -50; a second tile wraps in to fill the right gap
    expect(xs).toEqual([-50, 750]);
  });

  it("reverses the offset when the camera pans back (negative camX)", () => {
    const { ctx, xs } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    w.camera.x = -100; // camera panned back the other way
    r.render(w, { color: "#000", layers: [{ src: "bg.png", scrollX: 0, scrollY: 0, parallaxX: 0.5, parallaxY: 0 }] });
    // -camX*parallaxX = +50, wrapped into (-iw,0]: 50 - 800 = -750; the +50 tile follows
    expect(xs).toEqual([-750, 50]);
  });

  it("a deeper layer (smaller factor) tracks the camera more slowly", () => {
    const near = makeCtx();
    const far = makeCtx();
    const w = makeWorld();
    w.camera.x = 100;
    new Renderer(near.ctx as unknown as CanvasRenderingContext2D).render(w, {
      color: "#000",
      layers: [{ src: "bg.png", scrollX: 0, scrollY: 0, parallaxX: 0.8, parallaxY: 0 }],
    });
    new Renderer(far.ctx as unknown as CanvasRenderingContext2D).render(w, {
      color: "#000",
      layers: [{ src: "bg.png", scrollX: 0, scrollY: 0, parallaxX: 0.2, parallaxY: 0 }],
    });
    expect(near.xs[0]).toBe(-80); // -100 * 0.8
    expect(far.xs[0]).toBe(-20); // -100 * 0.2 — moves less, so it reads as farther away
  });

  it("a coupled layer at the camera origin is byte-identical to the pure time-drift path", () => {
    const { ctx, xs } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld(); // camera.x = 0 (the default)
    w.time = 1;
    // scrollX -70 (the legacy drift) + a parallaxX that contributes -camX*0.5 = 0 at the origin
    r.render(w, { color: "#000", layers: [{ src: "bg.png", scrollX: -70, scrollY: 0, parallaxX: 0.5, parallaxY: 0 }] });
    expect(xs).toEqual([-70, 730]); // matches the scrollX-only assertion in synthesis-0.3.1
  });

  it("composes drift and coupling additively", () => {
    const { ctx, xs } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    w.camera.x = 100; // coupling: -100 * 0.5 = -50
    w.time = 1; // drift: -70 * 1 = -70
    r.render(w, { color: "#000", layers: [{ src: "bg.png", scrollX: -70, scrollY: 0, parallaxX: 0.5, parallaxY: 0 }] });
    expect(xs).toEqual([-120, 680]); // -70 drift + -50 coupling
  });

  it("a layer authored WITHOUT parallax (legacy/pre-1.13.0 data) defaults to 0 → camera-independent", () => {
    // Additive safety: a background that predates the field parses with the factors filled to 0.
    const bg = BackgroundSchema.parse({ color: "#000", layers: [{ src: "bg.png", scrollX: -70 }] });
    const layer = (bg as { layers: { parallaxX: number; parallaxY: number; scrollY: number }[] }).layers[0];
    expect([layer.parallaxX, layer.parallaxY, layer.scrollY]).toEqual([0, 0, 0]);
    const { ctx, xs } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    w.camera.x = 500; // a large pan that an uncoupled layer must completely ignore
    w.time = 1;
    r.render(w, bg);
    expect(xs).toEqual([-70, 730]); // pure drift; the camera is ignored
  });
});
