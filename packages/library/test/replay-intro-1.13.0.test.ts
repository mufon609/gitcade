import { describe, it, expect } from "vitest";
import {
  Game,
  SceneSchema,
  createDefaultRegistry,
  snapshotWorld,
  type Registry,
  type BehaviorFn,
  type RunRecording,
} from "@gitcade/sdk";
import {
  ReplayIntro,
  attachReplayIntro,
  parseRecording,
  type ReplayIntroDoneInfo,
} from "../src/replay/index.js";

/**
 * 1.13.0 — the REPLAY INTRO host helper (`src/replay/`). A skippable "Echo" of the player's last
 * run, played back on the canvas before live play begins, built on the SDK's run-recording primitive
 * (`createReplay`, new in sdk 1.13.0). These drive the PURE controller manually (no rAF/DOM): a tiny
 * recording is captured with the SDK (a seeded `record: true` Game stepped a few frames), then the
 * controller is ticked to completion / skipped, and `onDone` is asserted to fire exactly once. The
 * attacher is checked only for headless no-op safety (the node env has no `requestAnimationFrame`).
 */

/** rng → x: forces the seeded stream into the snapshot, so each tick's snapshot is distinct. */
const rngDrift: BehaviorFn = (e, world) => {
  e.x += world.rng() * 10;
};

/** A one-entity scene whose state genuinely advances each tick (so snapshot identity is meaningful). */
function toyScene() {
  return {
    id: "toy",
    size: { width: 200, height: 200 },
    entities: [
      {
        id: "p",
        sprite: { kind: "none" },
        size: { w: 8, h: 8 },
        position: { x: 100, y: 100 },
        behaviors: [{ type: "toy-rng-drift", params: {} }],
      },
    ],
    systems: [],
  };
}

function toyRegistry(): Registry {
  const r = createDefaultRegistry();
  r.registerBehavior("toy-rng-drift", rngDrift);
  return r;
}

/** Fresh headless Game from the toy scene (parsed for defaults) + the toy registry + the given options. */
function makeGame(opts: { seed?: number; record?: boolean; entrySceneId?: string } = {}): Game {
  const scene = SceneSchema.parse(toyScene());
  return new Game({ scenes: [scene], config: {}, registry: toyRegistry(), canvas: null, ...opts });
}

/** Capture a recording of `frames` ticks of the toy run (no input — rng-drift alone advances state). */
function recordRun(frames: number, seed = 0x33): RunRecording {
  const g = makeGame({ seed, record: true });
  g.stepFrames(frames);
  return g.getRecording();
}

/** A ReplayIntro over a fresh replay Game booted from `rec`, plus a one-shot onDone spy. */
function makeIntro(rec: RunRecording): { intro: ReplayIntro; calls: () => number; info: () => ReplayIntroDoneInfo | null } {
  const replayGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId });
  let calls = 0;
  let info: ReplayIntroDoneInfo | null = null;
  const intro = new ReplayIntro({
    game: replayGame,
    recording: rec,
    onDone: (i) => {
      calls += 1;
      info = i;
    },
  });
  return { intro, calls: () => calls, info: () => info };
}

describe("ReplayIntro — completion", () => {
  it("ticking to completion fires onDone exactly once {skipped:false, atFrame:frameCount}; done/progress reach true/1", () => {
    const rec = recordRun(40);
    const { intro, calls, info } = makeIntro(rec);

    // One recorded tick per tick(fixedDt) call (the accumulator banks exactly one step each time).
    let guard = 0;
    while (!intro.done && guard++ < 10_000) intro.tick(rec.fixedDt);

    expect(intro.done).toBe(true);
    expect(calls()).toBe(1);
    expect(info()).toEqual({ skipped: false, atFrame: rec.frameCount });
    expect(intro.progress).toBe(1);

    // tick() after done is an idempotent no-op — onDone never fires again.
    intro.tick(rec.fixedDt);
    intro.tick(rec.fixedDt);
    expect(calls()).toBe(1);
  });

  it("plays back at the recorded pace via fixed-timestep catch-up (one big dt drains the remaining steps)", () => {
    const rec = recordRun(24);
    const { intro, calls, info } = makeIntro(rec);
    // A single oversized dt catches up every remaining step in one tick (bounded by the frame count).
    intro.tick(10);
    expect(intro.done).toBe(true);
    expect(calls()).toBe(1);
    expect(info()).toEqual({ skipped: false, atFrame: rec.frameCount });
  });
});

describe("ReplayIntro — skip", () => {
  it("skip() mid-playback fires onDone once {skipped:true,...}; later tick()/skip() do nothing", () => {
    const rec = recordRun(40);
    const { intro, calls, info } = makeIntro(rec);

    for (let i = 0; i < 10; i++) intro.tick(rec.fixedDt); // advance ~10 frames
    expect(intro.done).toBe(false);

    intro.skip();
    expect(calls()).toBe(1);
    expect(info()!.skipped).toBe(true);
    expect(info()!.atFrame).toBe(10);
    expect(intro.done).toBe(true);

    const frozen = intro.progress;
    intro.tick(rec.fixedDt); // no-op after done
    intro.skip(); // no-op after done
    expect(calls()).toBe(1);
    expect(intro.progress).toBe(frozen);
  });
});

describe("ReplayIntro — empty recording", () => {
  it("a 0-frame recording resolves onDone immediately on the first tick {skipped:false, atFrame:0}", () => {
    const rec = recordRun(0);
    expect(rec.frameCount).toBe(0);

    const { intro, calls, info } = makeIntro(rec);
    expect(intro.done).toBe(false); // not concluded until driven (so onDone is never stranded)

    intro.tick(0.016);
    expect(calls()).toBe(1);
    expect(info()).toEqual({ skipped: false, atFrame: 0 });
    expect(intro.done).toBe(true);
    expect(intro.progress).toBe(1);
  });
});

describe("ReplayIntro — schemaVersion guard", () => {
  it("a foreign schemaVersion throws at construction (the createReplay guard surfaces)", () => {
    const rec = recordRun(5);
    const bad = { ...rec, schemaVersion: 2 as unknown as 1 };
    const replayGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId });
    expect(() => new ReplayIntro({ game: replayGame, recording: bad, onDone: () => {} })).toThrow(/schemaVersion/);
  });
});

describe("parseRecording", () => {
  it("round-trips a real recording and the result drives a working intro", () => {
    const rec = recordRun(8);
    const parsed = parseRecording(JSON.stringify(rec));
    expect(parsed).not.toBeNull();
    expect(parsed!.frameCount).toBe(rec.frameCount);
    expect(parsed!.seed).toBe(rec.seed);
    expect(parsed!.sceneId).toBe(rec.sceneId);

    // The parsed blob is a usable recording: build an intro and drive it to completion.
    const { intro, calls } = makeIntro(parsed!);
    intro.tick(10);
    expect(intro.done).toBe(true);
    expect(calls()).toBe(1);
  });

  it("returns null on garbage / corrupt / wrong-schema blobs (never throws)", () => {
    const rec = recordRun(8);
    expect(parseRecording("")).toBeNull(); // the consumer's `?? ""` fallback
    expect(parseRecording("not json{")).toBeNull();
    expect(parseRecording("null")).toBeNull();
    expect(parseRecording("42")).toBeNull();
    expect(parseRecording('"a string"')).toBeNull();
    expect(parseRecording(JSON.stringify({ ...rec, schemaVersion: 2 }))).toBeNull();
    expect(parseRecording(JSON.stringify({ ...rec, frames: "nope" }))).toBeNull();
    expect(parseRecording(JSON.stringify({ ...rec, seed: "x" }))).toBeNull();
  });
});

describe("attachReplayIntro — headless no-op safety", () => {
  it("with no requestAnimationFrame: returns an idempotent stop fn, doesn't throw, and resolves onDone", () => {
    // Vitest runs in the node environment, so there is no animation clock — the headless path drives
    // the replay to completion so onDone still resolves (a non-browser host skips straight to live).
    expect(typeof requestAnimationFrame).toBe("undefined");

    const rec = recordRun(12);
    const { intro, calls } = makeIntro(rec);
    const canvas = { width: 200, height: 200 } as unknown as HTMLCanvasElement;

    let stop!: () => void;
    expect(() => {
      stop = attachReplayIntro(intro, canvas);
    }).not.toThrow();

    expect(typeof stop).toBe("function");
    expect(intro.done).toBe(true);
    expect(calls()).toBe(1);
    expect(() => {
      stop();
      stop(); // idempotent
    }).not.toThrow();
  });
});

describe("ReplayIntro — deterministic playback (snapshot identity)", () => {
  it("the controller's replay reproduces the original run's per-tick world snapshot byte-for-byte", () => {
    const SEED = 0x4242;
    const N = 30;

    // Original recorded run + its per-tick snapshots.
    const recGame = makeGame({ seed: SEED, record: true });
    const origSnaps: string[] = [];
    for (let f = 0; f < N; f++) {
      recGame.stepFrames(1);
      origSnaps.push(snapshotWorld(recGame.world));
    }
    const rec = recGame.getRecording();

    // Replay through the controller, snapshotting the replay world after each driven step.
    const { intro } = makeIntro(rec);
    const seen: string[] = [];
    let guard = 0;
    while (!intro.done && guard++ < 10_000) {
      intro.tick(rec.fixedDt); // exactly one step per call
      seen.push(snapshotWorld(intro.game.world));
    }

    expect(seen.length).toBe(N);
    expect(seen).toEqual(origSnaps); // byte-identical at every tick — the replay re-simulates the run
  });
});
