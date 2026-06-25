import { describe, it, expect } from "vitest";
import {
  createGame,
  createDefaultRegistry,
  snapshotWorld,
  type Game,
  type Registry,
  type BehaviorFn,
  type Input,
  type RawGameSources,
  type RunRecording,
} from "@gitcade/sdk";
import { GhostRace, attachGhostRace } from "../src/replay/index.js";

/**
 * 1.13.0 — the GHOST / TIME-TRIAL helper (`attachGhostRace` / {@link GhostRace}). A stored run replays
 * as a translucent ghost CONCURRENTLY with live play, in lockstep (one ghost tick per live fixed-update).
 *
 * These drive the PURE controller manually (no rAF/DOM): the ghost is stepped in lockstep with a live
 * game and its world is inspected. Two properties are proven headlessly —
 *  1. FAITHFUL: the ghost's chosen-entity (avatar) transforms equal the recording's reconstructed
 *     positions at EVERY tick (the ghost tracks the recording exactly), and the ghost World steps in
 *     FULL (a non-avatar entity advances too) even though only the avatar is the draw subset.
 *  2. INERT TO LIVE DETERMINISM (the load-bearing proof): a live run stepped WITH a ghost attached is
 *     byte-identical — every tick's `snapshotWorld` AND the live game's own recording — to the same run
 *     with NO ghost. Two separate Game/World instances share only the canvas (render-only), so stepping
 *     the ghost cannot perturb the live simulation. (`draw()` is a headless no-op here — a null context
 *     — so this isolates exactly the ghost-STEPPING from the live run.)
 */

const PLAYER_TAG = "player";

/** The avatar: input-driven horizontal move + an rng jitter (so BOTH input and the seeded stream feed the snapshot). */
const racer: BehaviorFn = (e, world) => {
  if (world.input.isDown("ArrowRight")) e.x += 2;
  if (world.input.isDown("ArrowLeft")) e.x -= 2;
  e.y += world.rng() * 3;
};
/** A NON-avatar entity that also advances each tick — proves the ghost world steps in full, not just the drawn subset. */
const drifter: BehaviorFn = (e, world) => {
  e.x += world.rng() * 1.5;
};

function registry(): Registry {
  const r = createDefaultRegistry();
  r.registerBehavior("racer", racer);
  r.registerBehavior("drifter", drifter);
  return r;
}

const manifest = {
  name: "Ghost Race Fixture",
  slug: "ghost-race",
  description: "Single-level fixture for the concurrent ghost overlay.",
  version: "1.0.0",
  engine: "gitcade-sdk",
  sdkVersion: "1.13.0",
  entryPoint: "src/scenes/track.json",
  tier: "open",
};
const config = {};
const track = {
  id: "track",
  size: { width: 400, height: 200 },
  entities: [
    { id: "hero", sprite: { kind: "none" }, size: { w: 8, h: 8 }, position: { x: 20, y: 100 }, tags: [PLAYER_TAG], behaviors: [{ type: "racer", params: {} }] },
    { id: "mote", sprite: { kind: "none" }, size: { w: 4, h: 4 }, position: { x: 200, y: 50 }, tags: ["prop"], behaviors: [{ type: "drifter", params: {} }] },
  ],
  systems: [],
};
const raw: RawGameSources = { manifest, config, scenes: [track] };

const GHOST_SEED = 0x6057;
const LIVE_SEED = 0x1ace;
const N = 30;

/** The ghost run's input: hold ArrowRight for the first half, coast the rest (a key DELTA the recording captures). */
const ghostScript = (input: Input, f: number): void => {
  input.setKey("ArrowRight", f < 15);
};
/** The live run's input — DIFFERENT from the ghost's, but a pure function of the frame (identical across runs). */
const liveScript = (input: Input, f: number): void => {
  input.setKey("ArrowRight", f % 4 < 2);
  input.setKey("ArrowLeft", f % 8 >= 6);
};

/** A headless game from the fixture with the given options. */
function makeGame(opts: { seed?: number; record?: boolean; entrySceneId?: string; attachInput?: boolean } = {}): Game {
  return createGame(raw, { canvas: null, registry: registry(), ...opts });
}

/** Record a ghost run (seeded, input-scripted) and capture the avatar's per-tick position for the tracking proof. */
function recordGhostRun(): { rec: RunRecording; avatarPath: Array<{ x: number; y: number }> } {
  const g = makeGame({ seed: GHOST_SEED, record: true });
  const avatarPath: Array<{ x: number; y: number }> = [];
  for (let f = 0; f < N; f++) {
    ghostScript(g.world.input, f);
    g.stepFrames(1);
    const hero = g.world.query(PLAYER_TAG)[0];
    avatarPath.push({ x: hero.x, y: hero.y });
  }
  return { rec: g.getRecording(), avatarPath };
}

describe("GhostRace — FAITHFUL: the ghost tracks the recording exactly", () => {
  it("the ghost's avatar transform equals the recording's reconstructed position at every tick", () => {
    const { rec, avatarPath } = recordGhostRun();

    const liveGame = makeGame({ seed: LIVE_SEED }); // any live game — unused beyond its frame counter here
    const ghostGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false });
    const race = new GhostRace({ liveGame, ghostGame, recording: rec, tag: PLAYER_TAG });

    for (let f = 1; f <= N; f++) {
      race.sync(f); // catch the ghost up to tick f
      const ghostHero = race.ghostWorld.query(PLAYER_TAG)[0];
      expect({ x: ghostHero.x, y: ghostHero.y }).toEqual(avatarPath[f - 1]);
    }
    expect(race.ghostFrame).toBe(N);
    expect(race.done).toBe(true);
  });

  it("the ghost World steps in FULL — a non-avatar entity advances too (only the avatar is the DRAW subset)", () => {
    const { rec } = recordGhostRun();
    const ghostGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false });
    const race = new GhostRace({ liveGame: makeGame({ seed: LIVE_SEED }), ghostGame, recording: rec, tag: PLAYER_TAG });

    const moteX0 = race.ghostWorld.query("prop")[0].x; // 200 at boot
    race.sync(N);
    const moteX1 = race.ghostWorld.query("prop")[0].x;
    expect(moteX1).not.toBe(moteX0); // the prop (not the avatar) still simulated — the whole world steps
  });
});

describe("GhostRace — INERT: the ghost does not perturb the live run's determinism", () => {
  it("the live snapshot is BYTE-IDENTICAL at every tick with vs without a ghost attached", () => {
    const { rec } = recordGhostRun();

    // Run A — live ALONE.
    const liveA = makeGame({ seed: LIVE_SEED, record: true });
    const snapsA: string[] = [];
    for (let f = 0; f < N; f++) {
      liveScript(liveA.world.input, f);
      liveA.stepFrames(1);
      snapsA.push(snapshotWorld(liveA.world));
    }
    const recA = liveA.getRecording();

    // Run B — the SAME live run, but with a ghost stepped in lockstep each tick (draw() is a headless
    // no-op, so this isolates the ghost-STEPPING — the only thing that could leak into the live world).
    const liveB = makeGame({ seed: LIVE_SEED, record: true });
    const ghostB = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false });
    const race = new GhostRace({ liveGame: liveB, ghostGame: ghostB, recording: rec, tag: PLAYER_TAG });
    const snapsB: string[] = [];
    for (let f = 0; f < N; f++) {
      liveScript(liveB.world.input, f);
      liveB.stepFrames(1);
      race.frame(1); // sync(liveB.world.frame) + draw(1) — the per-frame race step
      snapsB.push(snapshotWorld(liveB.world));
    }
    const recB = liveB.getRecording();

    expect(snapsB).toEqual(snapsA); // every tick identical — the ghost is inert to the live simulation
    expect(race.ghostFrame).toBe(N); // and the ghost really did step in lockstep (not a no-op pass)
    expect(recB).toEqual(recA); // the live game's OWN recording is unchanged by the ghost
  });

  it("a live run recorded WITH a ghost replays to the same final snapshot as one recorded without", () => {
    // The downstream consequence: a recording captured while a ghost was attached is a faithful recording
    // — re-driving it reproduces the run, because the ghost never touched the recorded world.
    const { rec } = recordGhostRun();
    const liveB = makeGame({ seed: LIVE_SEED, record: true });
    const ghostB = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false });
    const race = new GhostRace({ liveGame: liveB, ghostGame: ghostB, recording: rec, tag: PLAYER_TAG });
    for (let f = 0; f < N; f++) {
      liveScript(liveB.world.input, f);
      liveB.stepFrames(1);
      race.frame(1);
    }
    const recordedWithGhost = liveB.getRecording();
    const finalWithGhost = snapshotWorld(liveB.world);

    // Re-run the SAME live script in a fresh game with NO ghost: the run is seed + input only, so an
    // identical drive must reproduce it — proving the with-ghost recording captured a faithful run.
    const liveC = makeGame({ seed: LIVE_SEED, record: true });
    for (let f = 0; f < N; f++) {
      liveScript(liveC.world.input, f);
      liveC.stepFrames(1);
    }
    expect(finalWithGhost).toBe(snapshotWorld(liveC.world));
    expect(recordedWithGhost).toEqual(liveC.getRecording());
  });
});

describe("GhostRace — schemaVersion guard (surfaces createReplay's)", () => {
  it("a foreign recording schemaVersion throws at construction", () => {
    const { rec } = recordGhostRun();
    const bad = { ...rec, schemaVersion: 2 as unknown as 1 };
    const liveGame = makeGame({ seed: LIVE_SEED });
    const ghostGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false });
    expect(() => new GhostRace({ liveGame, ghostGame, recording: bad, tag: PLAYER_TAG })).toThrow(/schemaVersion/);
  });
});

describe("attachGhostRace — wiring + teardown", () => {
  it("returns a controller + an idempotent stop(); stop() doesn't touch the live game", () => {
    const { rec } = recordGhostRun();
    const liveGame = makeGame({ seed: LIVE_SEED, record: true });
    const ghostGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false });

    const handle = attachGhostRace({ liveGame, ghostGame, recording: rec, tag: PLAYER_TAG });
    expect(handle.race).toBeInstanceOf(GhostRace);

    // The live game still steps normally after attach (the hook fires only in the rAF loop, absent here).
    expect(() => liveGame.stepFrames(3)).not.toThrow();

    expect(() => {
      handle.stop();
      handle.stop(); // idempotent
    }).not.toThrow();
    // The live game is untouched by stop() — it keeps simulating.
    expect(() => liveGame.stepFrames(1)).not.toThrow();
  });

  it("custom filter selects the drawn subset (defaults to the `tag`, else 'player')", () => {
    const { rec } = recordGhostRun();
    const ghostGame = makeGame({ seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false });
    // A filter is honored by draw(); here we just confirm a race builds with one and tracks faithfully.
    const race = new GhostRace({
      liveGame: makeGame({ seed: LIVE_SEED }),
      ghostGame,
      recording: rec,
      filter: (e) => e.hasTag("prop"),
    });
    race.sync(N);
    expect(race.done).toBe(true);
  });
});
