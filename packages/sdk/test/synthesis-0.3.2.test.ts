import { describe, it, expect } from "vitest";
import { World, Entity, Renderer, createDefaultRegistry, SceneSchema } from "../src/index.js";
import { checkAdvisories } from "../src/validate/rules.js";

function makeWorld(): World {
  return new World({ bounds: { width: 800, height: 600 }, config: {}, registry: createDefaultRegistry() });
}

/** A recording 2D-context stub that captures the transform + draw ops we care about. */
function makeCtx() {
  const ops: Array<{ op: string; args: number[] }> = [];
  const rec = (op: string) => (...args: number[]) => ops.push({ op, args });
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    save: rec("save"),
    restore: rec("restore"),
    translate: rec("translate"),
    rotate: rec("rotate"),
    scale: rec("scale"),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    ellipse() {},
    fillText() {},
    fillRect: rec("fillRect"),
    strokeRect: rec("strokeRect"),
    drawImage: rec("drawImage"),
  };
  return { ctx, ops };
}

function addRect(world: World, init: { rotation?: number; scale?: number }): Entity {
  const e = new Entity({
    id: "r",
    x: 100,
    y: 100,
    w: 40,
    h: 20,
    layer: 0,
    sprite: { kind: "shape", shape: "rect", color: "#fff" },
    rotation: init.rotation,
    scale: init.scale,
  });
  world.add(e);
  return e;
}

describe("0.3.2 renderer honors entity.rotation + scale (declared-but-ignored slot)", () => {
  it("wraps a rotated/scaled entity in a center-anchored transform", () => {
    const { ctx, ops } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    addRect(w, { rotation: Math.PI / 2, scale: 2 }); // center = (120, 110)
    r.render(w, "#000");

    const rotate = ops.find((o) => o.op === "rotate");
    const scale = ops.find((o) => o.op === "scale");
    const translates = ops.filter((o) => o.op === "translate");
    expect(rotate?.args[0]).toBeCloseTo(Math.PI / 2, 6);
    expect(scale?.args).toEqual([2, 2]);
    // Translate to center, then back by the negative center.
    expect(translates[0]?.args).toEqual([120, 110]);
    expect(translates[1]?.args).toEqual([-120, -110]);
    // The transform is save/restore-balanced so it doesn't leak to later draws.
    expect(ops.filter((o) => o.op === "save").length).toBe(ops.filter((o) => o.op === "restore").length);
  });

  it("skips the transform entirely at the identity (byte-identical to pre-0.3.2)", () => {
    const { ctx, ops } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    addRect(w, {}); // rotation 0, scale 1
    r.render(w, "#000");
    expect(ops.some((o) => o.op === "rotate")).toBe(false);
    expect(ops.some((o) => o.op === "scale")).toBe(false);
    expect(ops.some((o) => o.op === "translate")).toBe(false);
    expect(ops.some((o) => o.op === "fillRect")).toBe(true); // it still drew
  });
});

describe("0.3.2 validator behavior-ordering advisories", () => {
  it("warns when a mover sets velocity with no integrator", () => {
    const scene = SceneSchema.parse({
      id: "s",
      entities: [{ id: "e", behaviors: [{ type: "ai-chase", params: { targetTag: "p", speed: 1 } }] }],
    });
    const issues = checkAdvisories([scene]);
    expect(issues.some((i) => i.code === "mover-without-integrator")).toBe(true);
  });

  it("does NOT warn when a velocity integrator follows the mover", () => {
    const scene = SceneSchema.parse({
      id: "s",
      entities: [
        { id: "e", behaviors: [{ type: "ai-chase", params: { targetTag: "p", speed: 1 } }, { type: "velocity", params: {} }] },
      ],
    });
    const issues = checkAdvisories([scene]);
    expect(issues.some((i) => i.code === "mover-without-integrator")).toBe(false);
  });

  it("warns on scale-by-state(velocity) ordered AFTER velocity — even inside a spawn prototype", () => {
    const scene = SceneSchema.parse({
      id: "s",
      entities: [],
      systems: [
        {
          type: "wave-spawner",
          params: {
            prototype: {
              id: "enemy",
              behaviors: [
                { type: "ai-chase", params: { targetTag: "p", speed: 1 } },
                { type: "velocity", params: {} },
                { type: "scale-by-state", params: { target: "velocity", mode: "multiply" } },
              ],
            },
          },
        },
      ],
    });
    const issues = checkAdvisories([scene]);
    const adv = issues.find((i) => i.code === "scale-ramp-after-integrator");
    expect(adv).toBeDefined();
    expect(adv?.where).toContain("prototype (enemy)");
  });

  it("does NOT warn when scale-by-state(velocity) precedes velocity (correct order)", () => {
    const scene = SceneSchema.parse({
      id: "s",
      entities: [
        {
          id: "e",
          behaviors: [
            { type: "ai-chase", params: { targetTag: "p", speed: 1 } },
            { type: "scale-by-state", params: { target: "velocity", mode: "multiply" } },
            { type: "velocity", params: {} },
          ],
        },
      ],
    });
    const issues = checkAdvisories([scene]);
    expect(issues.some((i) => i.code === "scale-ramp-after-integrator")).toBe(false);
  });
});
