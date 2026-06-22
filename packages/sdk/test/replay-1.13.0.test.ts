import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  Game,
  Input,
  SceneSchema,
  createDefaultRegistry,
  seededRng,
  snapshotWorld,
  scriptedConformanceInput,
  createReplay,
  type Registry,
  type BehaviorFn,
  type RunRecording,
} from "../src/index.js";

/**
 * 1.13.0 — the deterministic RUN RECORDER + REPLAY DRIVER (`replay.ts`). A Game built with
 * `{ seed, record: true }` captures its per-tick input (delta-encoded held keys + tap edges) using
 * its OWN monotonic tick counter; `createReplay` re-drives a FRESH `seededRng(seed)` Game through
 * that recording. THE acceptance property: the replay reproduces the original world state
 * byte-for-byte at every tick (`snapshotWorld` identity). The recorder reads input only, so a
 * non-recording game is byte-identical to today, and `seed: S` is exactly `rng: seededRng(S)`.
 */

// --- Toy behaviors so BOTH keys and taps (and the seeded rng) genuinely reach the snapshot. -------
/** rng → x: forces the seeded stream into the snapshot (a replay must reproduce the rng sequence). */
const rngDrift: BehaviorFn = (e, world) => {
  e.x += world.rng() * 10;
};
/** taps → state + y: a discrete tap writes its coords into snapshotted state and nudges y. */
const tapMover: BehaviorFn = (e, world) => {
  for (const p of world.input.justPressed()) {
    e.state.tapX = p.x;
    e.state.tapY = p.y;
    e.y += 2;
  }
};

function toyRegistry(): Registry {
  const r = createDefaultRegistry();
  r.registerBehavior("toy-rng-drift", rngDrift);
  r.registerBehavior("toy-tap-mover", tapMover);
  return r;
}

/**
 * A one-entity scene that genuinely reads input: two `keyboard-axis` movers (x + y, wired to the
 * keys the conformance script holds) feed `velocity`; `toy-rng-drift` mixes in the seeded rng; and
 * `toy-tap-mover` reacts to tap edges. So a desync in keys, taps, OR rng diverges the snapshot.
 */
function inputScene() {
  return {
    id: "s",
    size: { width: 300, height: 300 },
    entities: [
      {
        id: "p",
        sprite: { kind: "none" },
        size: { w: 8, h: 8 },
        position: { x: 150, y: 150 },
        behaviors: [
          { type: "keyboard-axis", params: { axis: "x", neg: ["ArrowLeft", "KeyA"], pos: ["ArrowRight", "KeyD"], speed: 80, touch: false } },
          { type: "keyboard-axis", params: { axis: "y", neg: ["ArrowUp", "KeyW"], pos: ["ArrowDown", "KeyS"], speed: 80, touch: false } },
          { type: "velocity", params: {} },
          { type: "toy-rng-drift", params: {} },
          { type: "toy-tap-mover", params: {} },
        ],
      },
    ],
    systems: [],
  };
}

/** Fresh Game from the input scene (parsed for defaults) + the toy registry + the given options. */
function makeGame(opts: { seed?: number; rng?: () => number; record?: boolean; entrySceneId?: string } = {}): Game {
  const scene = SceneSchema.parse(inputScene());
  return new Game({ scenes: [scene], config: {}, registry: toyRegistry(), canvas: null, ...opts });
}

/** Drive `g` for `n` ticks under `script`, collecting a per-tick snapshot. */
function driveScripted(g: Game, n: number, script: (input: Input, frame: number) => void): string[] {
  const snaps: string[] = [];
  for (let f = 0; f < n; f++) {
    script(g.world.input, f);
    g.stepFrames(1);
    snaps.push(snapshotWorld(g.world));
  }
  return snaps;
}

// ---------------------------------------------------------------------------
// THE acceptance test — byte-for-byte replay
// ---------------------------------------------------------------------------
describe("record → replay byte-identity", () => {
  it("replays a recorded run BYTE-FOR-BYTE (per-tick snapshot identity + finalSnapshot)", () => {
    const SEED = 0x1234;
    const N = 80;
    const tapAt = { x: 50, y: 70 };

    // Original: a seeded, RECORDING run driven by the scripted conformance input.
    const recGame = makeGame({ seed: SEED, record: true });
    const origSnaps = driveScripted(recGame, N, scriptedConformanceInput(tapAt));
    const rec = recGame.getRecording();
    rec.finalSnapshot = origSnaps[origSnaps.length - 1];

    // Recording provenance + shape.
    expect(rec.schemaVersion).toBe(1);
    expect(rec.seed).toBe(SEED);
    expect(rec.sceneId).toBe("s");
    expect(rec.frameCount).toBe(N);
    expect(rec.fixedDt).toBeCloseTo(1 / 60, 12);
    expect(rec.frames[0].f).toBe(0); // frame 0 always present
    // The conformance script taps on frame%29===14 (frames 14 & 43 within 80) — proves taps captured.
    expect(rec.frames.some((fr) => fr.taps && fr.taps.length > 0)).toBe(true);
    // Sparse: far fewer recorded frames than ticks (most ticks repeat the prior held set).
    expect(rec.frames.length).toBeLessThan(N);

    // Replay: a FRESH seeded Game booted from the recording, driven tick-by-tick by the controller.
    const playGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId });
    const replay = createReplay(playGame, rec);
    expect(replay.total).toBe(N);
    expect(replay.frame).toBe(0);
    expect(replay.done).toBe(false);
    expect(replay.progress).toBe(0);

    const replaySnaps: string[] = [];
    while (!replay.done) {
      replay.step();
      replaySnaps.push(snapshotWorld(playGame.world));
    }

    expect(replay.done).toBe(true);
    expect(replay.frame).toBe(N);
    expect(replay.progress).toBe(1);
    expect(replaySnaps.length).toBe(origSnaps.length);
    for (let f = 0; f < origSnaps.length; f++) {
      expect(replaySnaps[f]).toBe(origSnaps[f]); // byte-identical at EVERY tick
    }
    expect(replaySnaps[replaySnaps.length - 1]).toBe(rec.finalSnapshot); // integrity check holds
  });

  it("survives a JSON round-trip and replays identically (the recording is plain JSON)", () => {
    const recGame = makeGame({ seed: 99, record: true });
    const origSnaps = driveScripted(recGame, 60, scriptedConformanceInput({ x: 30, y: 40 }));
    const rec = recGame.getRecording();

    const rec2: RunRecording = JSON.parse(JSON.stringify(rec));
    const playGame = makeGame({ seed: rec2.seed, entrySceneId: rec2.sceneId });
    const replay = createReplay(playGame, rec2);
    const replaySnaps: string[] = [];
    while (!replay.done) {
      replay.step();
      replaySnaps.push(snapshotWorld(playGame.world));
    }
    expect(replaySnaps).toEqual(origSnaps);
  });

  it("step() past the end is an idempotent no-op", () => {
    const recGame = makeGame({ seed: 1, record: true });
    recGame.stepFrames(3);
    const rec = recGame.getRecording();
    const replay = createReplay(makeGame({ seed: rec.seed, entrySceneId: rec.sceneId }), rec);
    while (!replay.done) replay.step();
    const atEnd = snapshotWorld(replay.game.world);
    replay.step();
    replay.step();
    expect(replay.frame).toBe(rec.frameCount);
    expect(snapshotWorld(replay.game.world)).toBe(atEnd); // no further advance
  });
});

// ---------------------------------------------------------------------------
// Recording is opt-in and observationally inert (default path byte-identical)
// ---------------------------------------------------------------------------
describe("recording is opt-in and inert", () => {
  it("`seed: S` produces byte-identical state to `rng: seededRng(S)` (the new option ≡ the old path)", () => {
    const script = scriptedConformanceInput();
    const viaSeed = driveScripted(makeGame({ seed: 7 }), 50, script);
    const viaRng = driveScripted(makeGame({ rng: seededRng(7) }), 50, script);
    expect(viaSeed).toEqual(viaRng);
  });

  it("turning `record: true` ON does not perturb the simulation (identical to a non-recording seeded run)", () => {
    const script = scriptedConformanceInput();
    const recording = driveScripted(makeGame({ seed: 7, record: true }), 50, script);
    const plain = driveScripted(makeGame({ seed: 7 }), 50, script);
    expect(recording).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// Option guards
// ---------------------------------------------------------------------------
describe("option guards", () => {
  it("`seed` and `rng` are mutually exclusive", () => {
    expect(() => makeGame({ seed: 1, rng: seededRng(1) })).toThrow(/mutually exclusive/);
  });

  it("`record: true` requires a seed", () => {
    expect(() => makeGame({ record: true })).toThrow(/requires a `seed`/);
  });

  it("getRecording() on a non-recording game throws", () => {
    expect(() => makeGame({ seed: 1 }).getRecording()).toThrow(/recording is not enabled/);
  });

  it("resetRecording() is a safe no-op when recording is disabled", () => {
    expect(() => makeGame({}).resetRecording()).not.toThrow();
  });

  it("createReplay throws on a schemaVersion mismatch", () => {
    const recGame = makeGame({ seed: 1, record: true });
    recGame.stepFrames(5);
    const rec = recGame.getRecording();
    const playGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId });
    const bad = { ...rec, schemaVersion: 2 as unknown as 1 };
    expect(() => createReplay(playGame, bad)).toThrow(/schemaVersion/);
  });
});

// ---------------------------------------------------------------------------
// Sparse delta-encoding + re-arming
// ---------------------------------------------------------------------------
describe("recording shape — sparse delta encoding", () => {
  it("frame 0 is always present with the initial held set (empty when no input)", () => {
    const g = makeGame({ seed: 1, record: true });
    g.stepFrames(10); // no input at all
    const rec = g.getRecording();
    expect(rec.frameCount).toBe(10);
    expect(rec.frames).toEqual([{ f: 0, keys: [] }]); // only frame 0; nothing ever changed
  });

  it("emits a keys delta only when the held set changes", () => {
    const g = makeGame({ seed: 1, record: true });
    const input = g.world.input;
    input.setKey("ArrowRight", true);
    g.stepFrames(1); // f0: {ArrowRight}
    g.stepFrames(1); // f1: unchanged → omitted
    input.setKey("ArrowUp", true);
    g.stepFrames(1); // f2: {ArrowRight,ArrowUp}
    input.setKey("ArrowRight", false);
    input.setKey("ArrowUp", false);
    g.stepFrames(1); // f3: {} → change
    const rec = g.getRecording();
    expect(rec.frameCount).toBe(4);
    expect(rec.frames.map((fr) => fr.f)).toEqual([0, 2, 3]); // f1 omitted (no change)
    expect(rec.frames[0]).toEqual({ f: 0, keys: ["ArrowRight"] });
    expect(rec.frames[1]).toEqual({ f: 2, keys: ["ArrowRight", "ArrowUp"] });
    expect(rec.frames[2]).toEqual({ f: 3, keys: [] });
  });

  it("records a tap edge on the tick it occurs", () => {
    const g = makeGame({ seed: 1, record: true });
    g.stepFrames(1); // f0: keys [], no tap
    g.world.input.tap(12, 34);
    g.stepFrames(1); // f1: a tap edge
    const rec = g.getRecording();
    const tapFrame = rec.frames.find((fr) => fr.f === 1);
    expect(tapFrame?.taps).toEqual([{ x: 12, y: 34 }]);
    expect(tapFrame?.keys).toBeUndefined(); // held set unchanged ⇒ no keys delta on this frame
  });

  it("resetRecording() clears the buffer + counter and stays armed (re-arm at a level boundary)", () => {
    const g = makeGame({ seed: 1, record: true });
    g.world.input.setKey("KeyA", true);
    g.stepFrames(5);
    expect(g.getRecording().frameCount).toBe(5);

    g.resetRecording();
    const cleared = g.getRecording();
    expect(cleared.frameCount).toBe(0);
    expect(cleared.frames).toEqual([]);

    g.stepFrames(3); // still armed → records from frame 0 again
    const rec = g.getRecording();
    expect(rec.frameCount).toBe(3);
    expect(rec.frames[0]).toEqual({ f: 0, keys: ["KeyA"] }); // KeyA still held ⇒ re-emitted at frame 0
  });
});

// ---------------------------------------------------------------------------
// Input.heldKeys() accessor
// ---------------------------------------------------------------------------
describe("Input.heldKeys()", () => {
  it("returns a SORTED COPY of the held set", () => {
    const input = new Input();
    input.setKey("KeyD", true);
    input.setKey("ArrowUp", true);
    input.setKey("KeyA", true);
    expect(input.heldKeys()).toEqual(["ArrowUp", "KeyA", "KeyD"]); // sorted, not insertion order

    const held = input.heldKeys();
    held.push("ZZZ"); // mutating the returned array …
    expect(input.heldKeys()).toEqual(["ArrowUp", "KeyA", "KeyD"]); // … does not touch the live set
  });
});

// ---------------------------------------------------------------------------
// Provenance — guard the SDK_VERSION literal in replay.ts against drift
// ---------------------------------------------------------------------------
describe("recording provenance", () => {
  it("stamps sdkVersion equal to package.json version (catches a forgotten bump of the replay.ts literal)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const g = makeGame({ seed: 1, record: true });
    g.stepFrames(1);
    expect(g.getRecording().sdkVersion).toBe(pkg.version);
  });
});
