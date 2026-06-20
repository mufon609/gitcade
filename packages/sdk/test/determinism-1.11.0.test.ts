import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Game,
  World,
  Entity,
  createDefaultRegistry,
  SceneSchema,
  seededRng,
  snapshotWorld,
  runDeterminismCheck,
  assertDeterministic,
  scriptedConformanceInput,
  Input,
  type Registry,
  type Config,
  type BehaviorFn,
} from "../src/index.js";
import { validateGame } from "../src/validate/index.js";

/**
 * 1.11.0 — the DETERMINISM CONFORMANCE harness (`seededRng` / `snapshotWorld` / `runDeterminismCheck`).
 * The fixed-timestep simulation's only entropy seam is `world.rng`; given the same seed and input, two
 * headless runs must be byte-identical — the foundation of the reproducibility track (replays, ghosts,
 * seeded challenges). This suite proves the harness itself: a clean game reproduces, a deliberately
 * non-deterministic behavior is CAUGHT, the same seed re-runs identically while a different seed
 * diverges (so the check isn't trivially always-equal), and the validator surfaces it as an advisory.
 */

// --- Toy behaviors: one clean (routes entropy through world.rng), two dirty. -----------------------
/** Clean: advances x via the SEEDED rng — reproducible under a fixed seed. */
const rngX: BehaviorFn = (e, world) => {
  e.x += world.rng() * 10;
};
/** Dirty: unseeded `Math.random` — bypasses world.rng, so two runs never match. */
const mathRandomX: BehaviorFn = (e) => {
  e.x += Math.random() * 10;
};
/** Dirty: reads un-replayed host state (a module-level counter that LEAKS across runs). */
let leakCounter = 0;
const leakX: BehaviorFn = (e) => {
  e.x += leakCounter++ % 7;
};

function toyRegistry(): Registry {
  const r = createDefaultRegistry();
  r.registerBehavior("toy-rng-x", rngX);
  r.registerBehavior("toy-mathrandom-x", mathRandomX);
  r.registerBehavior("toy-leak-x", leakX);
  return r;
}

/** Build a Game from one inline scene (parsed for defaults) + a registry + an rng. */
function sceneGame(rawScene: unknown, config: Config, registry: Registry, rng: () => number): Game {
  const scene = SceneSchema.parse(rawScene);
  return new Game({ scenes: [scene], config, registry, rng, canvas: null });
}

/** A one-entity scene whose entity runs `behaviorType`. */
function oneBehaviorScene(behaviorType: string, params: Record<string, unknown> = {}) {
  return {
    id: "s",
    size: { width: 200, height: 200 },
    entities: [
      {
        id: "e",
        sprite: { kind: "none" },
        size: { w: 8, h: 8 },
        position: { x: 0, y: 0 },
        behaviors: [{ type: behaviorType, params }],
      },
    ],
    systems: [],
  };
}

// ---------------------------------------------------------------------------
// seededRng
// ---------------------------------------------------------------------------
describe("seededRng", () => {
  it("is reproducible: the same seed yields the same sequence", () => {
    const a = seededRng(12345);
    const b = seededRng(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqB).toEqual(seqA);
  });

  it("a different seed yields a different sequence, and draws stay in [0,1)", () => {
    const a = Array.from({ length: 8 }, seededRng(1));
    const b = Array.from({ length: 8 }, seededRng(2));
    expect(b).not.toEqual(a);
    for (const v of [...a, ...b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// snapshotWorld
// ---------------------------------------------------------------------------
describe("snapshotWorld", () => {
  const mkWorld = (): World => new World({ bounds: { width: 100, height: 100 }, config: {}, registry: createDefaultRegistry() });

  it("is stable under object-key insertion order (sorted keys)", () => {
    const w1 = mkWorld();
    const w2 = mkWorld();
    w1.state.b = 1;
    w1.state.a = 2; // inserted b then a
    w2.state.a = 2;
    w2.state.b = 1; // inserted a then b
    expect(snapshotWorld(w2)).toBe(snapshotWorld(w1));
  });

  it("keeps -0 distinct from 0 (never collapsed like JSON.stringify)", () => {
    const w = mkWorld();
    const e = new Entity({ id: "e", x: 0, y: 0, w: 1, h: 1, layer: 0, sprite: { kind: "none" } });
    w.add(e);
    const atZero = snapshotWorld(w);
    e.x = -0;
    const atNegZero = snapshotWorld(w);
    expect(atNegZero).not.toBe(atZero);
    expect(atNegZero).toContain('"x":"-0"');
  });

  it("captures NaN distinctly rather than as null", () => {
    const w = mkWorld();
    const e = new Entity({ id: "e", x: NaN, y: 0, w: 1, h: 1, layer: 0, sprite: { kind: "none" } });
    w.add(e);
    expect(snapshotWorld(w)).toContain('"x":"NaN"');
  });

  it("survives a cyclic reference in state without throwing", () => {
    const w = mkWorld();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    w.state.loop = cyc;
    expect(() => snapshotWorld(w)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// runDeterminismCheck / assertDeterministic
// ---------------------------------------------------------------------------
describe("runDeterminismCheck", () => {
  it("a clean rng-routed game is deterministic (same seed + input ⇒ byte-identical)", () => {
    const make = (rng: () => number): Game => sceneGame(oneBehaviorScene("toy-rng-x"), {}, toyRegistry(), rng);
    const r = runDeterminismCheck(make, { seed: 99, frames: 60 });
    expect(r.deterministic).toBe(true);
    expect(r.frames).toBe(60);
    expect(r.divergedAtFrame).toBeUndefined();
  });

  it("a no-rng game (pure velocity) is deterministic", () => {
    const make = (rng: () => number): Game => sceneGame(oneBehaviorScene("velocity", { vx: 50, vy: 0 }), {}, toyRegistry(), rng);
    expect(runDeterminismCheck(make, { frames: 40 }).deterministic).toBe(true);
  });

  it("CATCHES a Math.random behavior (entropy off world.rng)", () => {
    const make = (rng: () => number): Game => sceneGame(oneBehaviorScene("toy-mathrandom-x"), {}, toyRegistry(), rng);
    const r = runDeterminismCheck(make, { frames: 30 });
    expect(r.deterministic).toBe(false);
    expect(r.divergedAtFrame).toBeGreaterThanOrEqual(1);
    expect(() => assertDeterministic(make, { frames: 30 })).toThrow(/non-deterministic/);
  });

  it("CATCHES a behavior reading un-replayed host state (a leaking counter)", () => {
    const make = (rng: () => number): Game => sceneGame(oneBehaviorScene("toy-leak-x"), {}, toyRegistry(), rng);
    expect(runDeterminismCheck(make, { frames: 20 }).deterministic).toBe(false);
  });

  it("is not trivially always-equal: a DIFFERENT seed produces DIFFERENT state for an rng game", () => {
    const make = (rng: () => number): Game => sceneGame(oneBehaviorScene("toy-rng-x"), {}, toyRegistry(), rng);
    const finalSnap = (seed: number): string => {
      const g = make(seededRng(seed));
      g.stepFrames(40);
      return snapshotWorld(g.world);
    };
    expect(finalSnap(1)).not.toBe(finalSnap(2));
    // ...while the SAME seed reproduces exactly.
    expect(finalSnap(7)).toBe(finalSnap(7));
  });

  it("scripted input is applied identically to both runs (input-reading game stays deterministic)", () => {
    const make = (rng: () => number): Game =>
      sceneGame(
        {
          id: "s",
          size: { width: 200, height: 200 },
          entities: [
            {
              id: "p",
              sprite: { kind: "none" },
              size: { w: 8, h: 8 },
              position: { x: 100, y: 100 },
              behaviors: [
                { type: "keyboard-axis", params: { speed: 80 } },
                { type: "velocity", params: {} },
              ],
            },
          ],
          systems: [],
        },
        {},
        toyRegistry(),
        rng,
      );
    const r = runDeterminismCheck(make, { frames: 60, script: scriptedConformanceInput({ x: 100, y: 100 }) });
    expect(r.deterministic).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Input headless scripting
// ---------------------------------------------------------------------------
describe("Input scripting (setKey / tap)", () => {
  it("setKey holds and releases a key for the keyboard read paths", () => {
    const input = new Input();
    expect(input.isDown("ArrowUp")).toBe(false);
    input.setKey("ArrowUp", true);
    expect(input.isDown("ArrowUp")).toBe(true);
    expect(input.anyDown(["ArrowUp"])).toBe(true);
    expect(input.axis(["ArrowDown"], ["ArrowUp"])).toBe(1);
    input.setKey("ArrowUp", false);
    expect(input.isDown("ArrowUp")).toBe(false);
  });

  it("tap injects a one-frame click edge that endFrame clears", () => {
    const input = new Input();
    input.tap(42, 24);
    expect(input.clicked()).toBe(true);
    expect(input.taps()).toEqual([{ id: -1, x: 42, y: 24 }]);
    input.endFrame();
    expect(input.clicked()).toBe(false);
    expect(input.taps()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validator advisory wiring (warning-only, default-registry fast path)
// ---------------------------------------------------------------------------
describe("validator determinism advisory", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });
  const writeGame = (files: Record<string, unknown>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitcade-determinism-"));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, JSON.stringify(content, null, 2));
    }
    return dir;
  };

  it("runs on a clean pure-SDK game and reports it deterministic (no warning, still publishable)", async () => {
    const dir = writeGame({
      "game.json": {
        name: "Mini",
        slug: "mini",
        version: "0.1.0",
        engine: "gitcade-sdk",
        sdkVersion: "0.1.0",
        entryPoint: "src/scenes/main.json",
        tier: "open",
      },
      "config.json": { speed: 100 },
      "src/scenes/main.json": {
        id: "main",
        entities: [
          {
            id: "ball",
            sprite: { kind: "shape", shape: "circle", color: "#fff" },
            size: { w: 10, h: 10 },
            position: { x: 10, y: 10 },
            behaviors: [{ type: "velocity", params: { vx: "$cfg.speed" } }, { type: "bounce-world-edges", params: {} }],
          },
        ],
        systems: [],
      },
    });
    const r = await validateGame(dir);
    expect(r.ok).toBe(true);
    expect(r.determinism?.checked).toBe(true);
    expect(r.determinism?.deterministic).toBe(true);
    expect(r.issues.some((i) => i.code === "nondeterministic")).toBe(false);
  });
});
