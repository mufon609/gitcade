import { describe, it, expect, beforeAll } from "vitest";
import { World, Renderer, createDefaultRegistry, SceneSchema } from "../src/index.js";
import { checkAdvisories } from "../src/validate/rules.js";

function makeWorld(): World {
  return new World({ bounds: { width: 800, height: 600 }, config: {}, registry: createDefaultRegistry() });
}

// ── WS②: persistence restore signal (IC-9) ──────────────────────────────────
describe("0.3.1 persistence restore signal (IC-9)", () => {
  it("whenRestored resolves when resolvePersistKeys releases the keys", async () => {
    const w = makeWorld();
    let done = false;
    const p = w.whenRestored(["best"]).then(() => (done = true));
    w.claimPersistKeys(["best"]);
    expect(done).toBe(false); // still pending while the load is 'in flight'
    w.resolvePersistKeys(["best"]);
    await p;
    expect(done).toBe(true);
  });

  it("emits a persist-restored event carrying the released keys", () => {
    const w = makeWorld();
    const seen: unknown[] = [];
    w.events.on("persist-restored", (d) => seen.push(d));
    w.resolvePersistKeys(["coins", "best"]);
    expect(seen).toEqual([{ keys: ["coins", "best"] }]);
  });

  it("whenRestored resolves immediately if the keys are already restored", async () => {
    const w = makeWorld();
    w.resolvePersistKeys(["best"]);
    let done = false;
    await w.whenRestored(["best"]).then(() => (done = true));
    expect(done).toBe(true);
  });

  it("only resolves once ALL awaited keys are restored", async () => {
    const w = makeWorld();
    let done = false;
    const p = w.whenRestored(["a", "b"]).then(() => (done = true));
    w.resolvePersistKeys(["a"]);
    await Promise.resolve();
    expect(done).toBe(false); // 'b' still outstanding
    w.resolvePersistKeys(["b"]);
    await p;
    expect(done).toBe(true);
  });

  it("resetPersistTracking resolves a leftover waiter (no hang) and clears the restored set", async () => {
    const w = makeWorld();
    let done = false;
    const p = w.whenRestored(["best"]).then(() => (done = true));
    w.resetPersistTracking(); // scene change with the load still pending
    await p;
    expect(done).toBe(true);
    // restored set cleared → a fresh wait does NOT resolve from the old scene
    let again = false;
    void w.whenRestored(["best"]).then(() => (again = true));
    await Promise.resolve();
    expect(again).toBe(false);
  });
});

// ── WS①: renderer background.layers + tilemap fallback tint ──────────────────
class StubImage {
  src = "";
  complete = true;
  naturalWidth = 800;
  naturalHeight = 600;
}
function makeCtx() {
  const calls: Array<Record<string, unknown>> = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    ellipse() {},
    fillText() {},
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "fillRect", x, y, w, h, fillStyle: ctx.fillStyle });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "strokeRect", x, y, w, h, strokeStyle: ctx.strokeStyle });
    },
    drawImage(...args: unknown[]) {
      calls.push({ op: "drawImage", x: args[1], y: args[2] });
    },
  };
  return { ctx, calls };
}

describe("0.3.1 renderer background.layers parallax (snake-05 et al.)", () => {
  beforeAll(() => {
    (globalThis as unknown as { Image: unknown }).Image = StubImage;
  });

  it("tiles a full-field layer once at rest (time=0)", () => {
    const { ctx, calls } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    w.time = 0;
    r.render(w, { color: "#000", layers: [{ src: "stars.png", scrollX: -70, scrollY: 0 }] });
    // `+ 0` normalizes JS negative-zero (`-70 * 0 === -0`) — identical pixel, toEqual is strict.
    const draws = calls.filter((c) => c.op === "drawImage").map((c) => ({ op: c.op, x: (c.x as number) + 0, y: (c.y as number) + 0 }));
    expect(draws).toEqual([{ op: "drawImage", x: 0, y: 0 }]);
  });

  it("wraps the layer seamlessly (two tiles) once it has scrolled", () => {
    const { ctx, calls } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    w.time = 1; // scrollX -70 → offset -70
    r.render(w, { color: "#000", layers: [{ src: "stars.png", scrollX: -70, scrollY: 0 }] });
    const xs = calls.filter((c) => c.op === "drawImage").map((c) => c.x);
    expect(xs).toEqual([-70, 730]); // first tile drifted left, second wraps in to cover the gap
  });

  it("a plain color background draws no layers", () => {
    const { ctx, calls } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    r.render(makeWorld(), "#0b0b16");
    expect(calls.some((c) => c.op === "drawImage")).toBe(false);
  });
});

describe("0.3.1 tilemap fallback tint + gridline (td-09)", () => {
  it("tints from properties[idx].color and outlines each cell", () => {
    const { ctx, calls } = makeCtx();
    const r = new Renderer(ctx as unknown as CanvasRenderingContext2D);
    const w = makeWorld();
    w.tilemap = {
      tileSize: 40,
      cols: 2,
      rows: 1,
      tiles: [0, 1],
      properties: { "0": { color: "#ff0000" } },
    } as unknown as NonNullable<World["tilemap"]>;
    r.render(w); // no tileset → fallback path
    const fills = calls.filter((c) => c.op === "fillRect");
    expect(fills.some((c) => c.fillStyle === "#ff0000" && c.x === 0)).toBe(true); // authored tint
    expect(calls.filter((c) => c.op === "strokeRect").length).toBe(2); // a gridline per non-empty cell
  });
});

// ── WS③: validator advisories (IC-10, helicopter-05/sa-06) ───────────────────
function scene(entities: unknown[]) {
  return SceneSchema.parse({ id: "play", entities });
}

describe("0.3.1 validator advisories", () => {
  it("warns on a HUD entity in the top-left corner button zone", () => {
    const issues = checkAdvisories([scene([{ id: "hud-score", tags: ["hud"], position: { x: 12, y: 10 }, size: { w: 160, h: 24 } }])]);
    expect(issues.some((i) => i.code === "hud-corner-button" && i.level === "warning")).toBe(true);
  });

  it("does NOT warn on HUD cleared to x:60", () => {
    const issues = checkAdvisories([scene([{ id: "hud-score", tags: ["hud"], position: { x: 60, y: 10 }, size: { w: 160, h: 24 } }])]);
    expect(issues.some((i) => i.code === "hud-corner-button")).toBe(false);
  });

  it("warns on a near-full-field rect anchored at center coords", () => {
    const issues = checkAdvisories([scene([{ id: "tap", tags: ["ui"], position: { x: 400, y: 300 }, size: { w: 800, h: 600 } }])]);
    expect(issues.some((i) => i.code === "fullfield-rect-offset" && i.level === "warning")).toBe(true);
  });

  it("does NOT warn on a full-field rect anchored at {0,0}", () => {
    const issues = checkAdvisories([scene([{ id: "tap", tags: ["ui"], position: { x: 0, y: 0 }, size: { w: 800, h: 600 } }])]);
    expect(issues.some((i) => i.code === "fullfield-rect-offset")).toBe(false);
  });

  it("does NOT warn on an edge-anchored scrolling decor tile (no false positive)", () => {
    const issues = checkAdvisories([scene([{ id: "bg-b", tags: ["decor"], position: { x: 800, y: 0 }, size: { w: 800, h: 600 } }])]);
    expect(issues.some((i) => i.code === "fullfield-rect-offset")).toBe(false);
  });
});
