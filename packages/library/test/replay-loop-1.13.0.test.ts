import { describe, it, expect } from "vitest";
import {
  Game,
  SceneSchema,
  createDefaultRegistry,
  type Registry,
  type BehaviorFn,
  type RunRecording,
} from "@gitcade/sdk";
import { attachReplayLoop } from "../src/replay/index.js";

/**
 * 1.13.0 — the REPLAY LOOP host helper (`src/replay/replay-loop.ts`). The arcade ATTRACT wrapper over
 * {@link attachReplayIntro}: the recorded "Echo" replays on REPEAT until the player presses a key, and
 * that keypress starts live play. These prove the three loop behaviors:
 *  - natural completion RE-CYCLES (it attract-loops; `onStart` is NOT yet called),
 *  - a skip starts live EXACTLY ONCE and stops the loop, and
 *  - headless (no `requestAnimationFrame`) plays one cycle, fires `onStart` once, and does NOT hang.
 *
 * The browser path needs an animation clock, so the first two run under a tiny FAKE-rAF harness
 * ({@link withFakeRaf}): a hand-pumped `requestAnimationFrame` + a shared `performance.now` clock + a
 * fake `window`/`canvas` for skip input. The headless test runs in the bare node env (no rAF), exactly
 * as the existing replay-intro test exercises the attacher's headless no-op path.
 */

/** rng → x: forces the seeded stream into the snapshot, so each replayed tick genuinely advances. */
const rngDrift: BehaviorFn = (e, world) => {
  e.x += world.rng() * 10;
};

/** A one-entity scene whose state advances each tick (so a replay has real frames to play back). */
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

/** Fresh headless Game from the toy scene + toy registry + the given options. */
function makeGame(opts: { seed?: number; record?: boolean; entrySceneId?: string } = {}): Game {
  const scene = SceneSchema.parse(toyScene());
  return new Game({ scenes: [scene], config: {}, registry: toyRegistry(), canvas: null, ...opts });
}

/** Capture a recording of `frames` ticks of the toy run (no input — rng-drift alone advances state). */
function recordRun(frames: number, seed = 0x55): RunRecording {
  const g = makeGame({ seed, record: true });
  g.stepFrames(frames);
  return g.getRecording();
}

/**
 * A `makeReplayGame` factory that COUNTS calls — each call is one attract cycle, so the count is the
 * number of cycles the loop has built (1 after the first cycle, 2 after one re-attract, …). Every game
 * is freshly seeded from the recording, so each cycle's replay is byte-identical.
 */
function gameFactory(rec: RunRecording): { make: () => Game; count: () => number } {
  let n = 0;
  return {
    make: () => {
      n += 1;
      return makeGame({ seed: rec.seed, entrySceneId: rec.sceneId });
    },
    count: () => n,
  };
}

/** The fake-rAF harness handed to a browser-path test body. */
interface FakeHarness {
  /** A fake canvas (no 2D context → the echo treatment is skipped; render no-ops on a null-ctx game). */
  canvas: HTMLCanvasElement;
  /** Advance the shared clock by `advanceMs` and fire every rAF callback queued BEFORE this call once. */
  pump: (advanceMs: number) => void;
  /** Dispatch a `window` keydown with the given `KeyboardEvent.code` (a skip key). */
  fireKey: (code: string) => void;
  /** Dispatch a `pointerdown` on the canvas (a skip tap). */
  firePointer: () => void;
  /** How many rAF callbacks are currently queued (active loops) — 1 while attracting, 0 once torn down. */
  pending: () => number;
}

/**
 * Install a deterministic, hand-pumped `requestAnimationFrame`/`cancelAnimationFrame`, a fake `window`
 * + `canvas` for skip input, and a `performance.now` tied to the SAME clock `pump` advances (so
 * attachReplayIntro's `last`/`now` dt math actually advances the replay). Globals are captured and
 * restored in `finally`, so the headless test in this file still sees a bare node env.
 */
function withFakeRaf(run: (h: FakeHarness) => void): void {
  const g = globalThis as Record<string, unknown>;
  const keys = ["requestAnimationFrame", "cancelAnimationFrame", "window", "performance"];
  const saved = keys.map((k) => Object.getOwnPropertyDescriptor(g, k));
  const define = (k: string, value: unknown): void => {
    Object.defineProperty(g, k, { value, configurable: true, writable: true });
  };

  let clock = 0;
  let nextId = 1;
  const scheduled = new Map<number, (t: number) => void>();
  const keyListeners = new Set<(e: { code: string }) => void>();
  const pointerListeners = new Set<() => void>();

  define("requestAnimationFrame", (cb: (t: number) => void): number => {
    const id = nextId++;
    scheduled.set(id, cb);
    return id;
  });
  define("cancelAnimationFrame", (id: number): void => {
    scheduled.delete(id);
  });
  define("window", {
    addEventListener: (type: string, h: (e: { code: string }) => void): void => {
      if (type === "keydown") keyListeners.add(h);
    },
    removeEventListener: (type: string, h: (e: { code: string }) => void): void => {
      if (type === "keydown") keyListeners.delete(h);
    },
  });
  define("performance", { now: () => clock });

  const canvas = {
    width: 200,
    height: 200,
    addEventListener: (type: string, h: () => void): void => {
      if (type === "pointerdown") pointerListeners.add(h);
    },
    removeEventListener: (type: string, h: () => void): void => {
      if (type === "pointerdown") pointerListeners.delete(h);
    },
  } as unknown as HTMLCanvasElement;

  const harness: FakeHarness = {
    canvas,
    // Snapshot first: a callback that re-schedules (a continuing loop) or starts a fresh cycle (a
    // re-attract) runs on the NEXT pump, so each pump is exactly one frame per active loop.
    pump: (advanceMs: number): void => {
      clock += advanceMs;
      const due = [...scheduled.entries()];
      for (const [id, cb] of due) {
        scheduled.delete(id);
        cb(clock);
      }
    },
    fireKey: (code: string): void => {
      for (const h of [...keyListeners]) h({ code });
    },
    firePointer: (): void => {
      for (const h of [...pointerListeners]) h();
    },
    pending: () => scheduled.size,
  };

  try {
    run(harness);
  } finally {
    keys.forEach((k, i) => {
      const d = saved[i];
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    });
  }
}

describe("attachReplayLoop — natural completion re-attracts (the loop)", () => {
  it("a fully-played Echo RE-CYCLES (fresh seeded cycle) and never starts live on its own", () => {
    withFakeRaf((h) => {
      const rec = recordRun(6); // a short Echo so a couple of pumps complete it
      const { make, count } = gameFactory(rec);
      let starts = 0;
      const stop = attachReplayLoop(h.canvas, {
        makeReplayGame: make,
        recording: rec,
        onStart: () => {
          starts += 1;
        },
      });

      expect(count()).toBe(1); // cycle 1 built its replay game synchronously
      expect(h.pending()).toBe(1); // and scheduled its rAF loop

      // Drive frames until the first cycle plays out and the loop re-attracts a second cycle.
      let guard = 0;
      while (count() < 2 && guard++ < 500) h.pump(50);

      expect(count()).toBe(2); // re-cycled → a fresh seeded replay game was built
      expect(starts).toBe(0); // natural completion never starts live — it loops
      expect(h.pending()).toBe(1); // exactly one active loop (the new cycle), not a leak

      // It KEEPS looping — drive to a third cycle.
      guard = 0;
      while (count() < 3 && guard++ < 500) h.pump(50);
      expect(count()).toBe(3);
      expect(starts).toBe(0);

      stop();
      expect(h.pending()).toBe(0); // stop() tore the live cycle down
    });
  });
});

describe("attachReplayLoop — a skip is the start", () => {
  it("a skip key fires onStart EXACTLY ONCE and stops the loop (no further cycles)", () => {
    withFakeRaf((h) => {
      const rec = recordRun(120); // a long Echo so it won't self-complete before we skip
      const { make, count } = gameFactory(rec);
      let starts = 0;
      const stop = attachReplayLoop(h.canvas, {
        makeReplayGame: make,
        recording: rec,
        onStart: () => {
          starts += 1;
        },
      });

      expect(count()).toBe(1);
      h.pump(16); // ~1 frame — nowhere near 120, so it's still attracting
      expect(starts).toBe(0);
      expect(count()).toBe(1);

      h.fireKey("Space"); // a skip key → the keypress IS the start
      expect(starts).toBe(1); // onStart fired exactly once
      expect(count()).toBe(1); // no re-cycle
      expect(h.pending()).toBe(0); // the cycle was torn down (no pending rAF)

      // Further frames / keys do nothing — the loop is over.
      h.pump(50);
      h.pump(50);
      h.fireKey("Space");
      expect(starts).toBe(1);
      expect(count()).toBe(1);

      stop(); // idempotent post-start no-op — does not re-fire onStart
      expect(starts).toBe(1);
    });
  });

  it("a pointer tap also counts as the start (onStart once, loop stops)", () => {
    withFakeRaf((h) => {
      const rec = recordRun(120);
      const { make, count } = gameFactory(rec);
      let starts = 0;
      attachReplayLoop(h.canvas, {
        makeReplayGame: make,
        recording: rec,
        onStart: () => {
          starts += 1;
        },
      });

      h.pump(16);
      h.firePointer();
      expect(starts).toBe(1);
      expect(count()).toBe(1);
      expect(h.pending()).toBe(0);
    });
  });
});

describe("attachReplayLoop — stop() during attract", () => {
  it("stop() halts the loop and tears the cycle down WITHOUT firing onStart", () => {
    withFakeRaf((h) => {
      const rec = recordRun(120);
      const { make, count } = gameFactory(rec);
      let starts = 0;
      const stop = attachReplayLoop(h.canvas, {
        makeReplayGame: make,
        recording: rec,
        onStart: () => {
          starts += 1;
        },
      });

      h.pump(16);
      expect(h.pending()).toBe(1); // attracting

      stop();
      expect(starts).toBe(0); // teardown is NOT a skip — onStart never fires
      expect(h.pending()).toBe(0); // loop torn down

      // After stop, nothing re-attracts and a stray key/frame is inert.
      h.pump(50);
      h.fireKey("Space");
      expect(starts).toBe(0);
      expect(count()).toBe(1);

      stop(); // idempotent
      expect(starts).toBe(0);
    });
  });
});

describe("attachReplayLoop — headless no-op safety", () => {
  it("with no requestAnimationFrame: plays ONE cycle, fires onStart once, does not hang", () => {
    // Vitest's node env has no animation clock — attachReplayIntro drives each cycle to completion
    // synchronously, so the loop must play exactly one cycle and hand straight to live (never recurse).
    expect(typeof requestAnimationFrame).toBe("undefined");

    const rec = recordRun(12);
    const { make, count } = gameFactory(rec);
    let starts = 0;
    const canvas = { width: 200, height: 200 } as unknown as HTMLCanvasElement;

    let stop!: () => void;
    expect(() => {
      stop = attachReplayLoop(canvas, {
        makeReplayGame: make,
        recording: rec,
        onStart: () => {
          starts += 1;
        },
      });
    }).not.toThrow();

    expect(count()).toBe(1); // exactly one cycle (no infinite re-cycle)
    expect(starts).toBe(1); // handed straight to live, exactly once
    expect(typeof stop).toBe("function");
    expect(() => {
      stop();
      stop(); // idempotent post-start no-op
    }).not.toThrow();
    expect(starts).toBe(1);
  });

  it("an EMPTY recording headless still resolves to one onStart (never strands the start)", () => {
    expect(typeof requestAnimationFrame).toBe("undefined");

    const rec = recordRun(0);
    expect(rec.frameCount).toBe(0);
    const { make, count } = gameFactory(rec);
    let starts = 0;
    const canvas = { width: 200, height: 200 } as unknown as HTMLCanvasElement;

    attachReplayLoop(canvas, {
      makeReplayGame: make,
      recording: rec,
      onStart: () => {
        starts += 1;
      },
    });

    expect(count()).toBe(1);
    expect(starts).toBe(1);
  });
});
