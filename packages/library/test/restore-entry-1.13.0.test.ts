import { describe, it, expect } from "vitest";
import {
  createGame,
  createReplay,
  createDefaultRegistry,
  snapshotWorld,
  type Game,
  type Registry,
  type BehaviorFn,
  type RawGameSources,
  type RunRecording,
} from "@gitcade/sdk";
import { restoreRecordingEntry } from "../src/replay/index.js";

/**
 * 1.13.0 — {@link restoreRecordingEntry}, the LIVE-game counterpart to {@link createReplay}'s entry
 * restore. createReplay restores a recording's `entryState` + seeded-RNG phase onto a REPLAY game it
 * then drives; restoreRecordingEntry does the SAME restore onto a game the host will `start()` and play
 * LIVE — so a live re-entry of a mid-campaign level (a retry, a level-select) resumes from the carried
 * slice the level was reached with, instead of from defaults.
 *
 * The fixture mirrors the SDK's faithful-level-replay fixture: an INPUT-FREE level-2 whose per-tick
 * trajectory is a pure function of the carried `world.state` + the seeded RNG. Because there is no input
 * to re-feed, a live game RESTORED with restoreRecordingEntry and then PLAINLY stepped reproduces the
 * recorded run byte-for-byte — which is precisely the property: the helper is the only thing bridging a
 * from-scratch isolation boot to the recorded entry. level-1 BURNS rng each tick so the entry RNG phase
 * is non-zero (the phase, not just the state, must be restored).
 */

const FULL_HP = 3;
const PARTIAL_HP = 1; // level-2 is entered on a sliver (so a wrong/absent restore visibly diverges)
const SEED = 0x1abe1;
const N = 60;
const LEVEL1_TICKS = 9; // level-1 burns rng for this many ticks → a non-zero entry phase

/** level-2 hero: seeds hp from the carried `world.state.carriedHp`, then couples it into an rng-driven trajectory. */
const carriedHpBleeder: BehaviorFn = (e, world) => {
  if (e.state.hp === undefined) e.state.hp = (world.state.carriedHp as number | undefined) ?? FULL_HP;
  const hp = e.state.hp as number;
  e.x += world.rng() * hp; // hp (the entry state) scales the motion
  e.y += world.rng() * 0.5; // hp-independent, keeps the stream advancing in lockstep
  if (world.rng() < 0.15 && hp > 0) e.state.hp = hp - 1; // occasional seeded "damage"
};
/** level-1: one rng draw per tick → the seeded stream advances before the level-2 boundary. */
const rngBurner: BehaviorFn = (e, world) => {
  e.x += world.rng();
};

function registry(): Registry {
  const r = createDefaultRegistry();
  r.registerBehavior("carried-hp-bleeder", carriedHpBleeder);
  r.registerBehavior("rng-burner", rngBurner);
  return r;
}

const manifest = {
  name: "Restore Entry Fixture",
  slug: "restore-entry",
  description: "Two-level fixture for the LIVE entry restore.",
  version: "1.0.0",
  engine: "gitcade-sdk",
  sdkVersion: "1.13.0",
  entryPoint: "src/scenes/level-1.json",
  tier: "open",
  levels: ["level-1", "level-2"],
};
const config = {};
const level1 = {
  id: "level-1",
  size: { width: 200, height: 200 },
  entities: [{ id: "burner", sprite: { kind: "none" }, size: { w: 8, h: 8 }, position: { x: 0, y: 0 }, behaviors: [{ type: "rng-burner", params: {} }] }],
  systems: [],
  flow: { persist: ["carriedHp"] },
};
const level2 = {
  id: "level-2",
  size: { width: 200, height: 200 },
  entities: [{ id: "hero", sprite: { kind: "none" }, size: { w: 8, h: 8 }, position: { x: 20, y: 20 }, behaviors: [{ type: "carried-hp-bleeder", params: {} }] }],
  systems: [],
};
const raw: RawGameSources = { manifest, config, scenes: [level1, level2] };

function driveSnaps(g: Game, n: number): string[] {
  const snaps: string[] = [];
  for (let f = 0; f < n; f++) {
    g.stepFrames(1);
    snaps.push(snapshotWorld(g.world));
  }
  return snaps;
}

/** Record a level-2 run reached the REAL way (through an rng-burning level-1 at PARTIAL carried hp). */
function recordL2(): { rec: RunRecording; origSnaps: string[] } {
  const g = createGame(raw, { canvas: null, registry: registry(), seed: SEED, record: true });
  g.stepFrames(LEVEL1_TICKS); // level-1 burns rng → the stream advances
  g.world.state.carriedHp = PARTIAL_HP; // the host stashes the carried hp before advancing
  g.requestNextLevel();
  g.stepFrames(1); // drain → level-2 active, carriedHp carried via flow.persist
  g.resetRecording(); // re-arm: frame 0 captures level-2's entryState + the non-zero RNG phase
  const origSnaps = driveSnaps(g, N);
  return { rec: g.getRecording(), origSnaps };
}

describe("restoreRecordingEntry — restores the captured entry onto a LIVE (non-replay) game", () => {
  it("re-applies entryState (clear-then-assign) AND fast-forwards the seeded RNG phase", () => {
    const { rec } = recordL2();
    expect(rec.entryState!.carriedHp).toBe(PARTIAL_HP);
    expect(rec.entryRngCalls).toBeGreaterThan(0); // level-1 advanced the stream

    // A fresh isolation boot starts from DEFAULTS: no carriedHp, RNG at position 0.
    const live = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    expect(live.world.state.carriedHp).toBeUndefined();
    expect(live.world.rngCalls).toBe(0);

    restoreRecordingEntry(live, rec);
    expect(live.world.state).toEqual(rec.entryState); // world.state is EXACTLY the captured slice
    expect(live.world.rngCalls).toBe(rec.entryRngCalls); // stream fast-forwarded to the entry phase
  });

  it("a live game restored this way then PLAINLY stepped reproduces the recorded run byte-for-byte", () => {
    // THE property: there is no input in this fixture, so the only thing that can make a from-scratch
    // isolation boot reproduce the campaign-entered run is restoring its entry state + RNG phase.
    const { rec, origSnaps } = recordL2();
    const live = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    restoreRecordingEntry(live, rec);
    const seen = driveSnaps(live, N);
    expect(seen).toEqual(origSnaps); // identical at every tick — the live re-entry resumes the run
  });

  it("establishes the SAME start state createReplay does (the live path == the replay path)", () => {
    // Pre-step equivalence: right after the restore, a LIVE-restored game and a createReplay-restored
    // game hold byte-identical worlds — restoreRecordingEntry is createReplay's restore, applied for live.
    const { rec } = recordL2();
    const live = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    const replayGame = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    restoreRecordingEntry(live, rec);
    createReplay(replayGame, rec); // constructor restores entryState + phase onto the replay game
    expect(snapshotWorld(live.world)).toBe(snapshotWorld(replayGame.world));
    expect(live.world.rngCalls).toBe(replayGame.world.rngCalls);
  });

  it("WITHOUT the restore, the same isolation boot diverges (proves the restore is load-bearing)", () => {
    const { rec, origSnaps } = recordL2();
    const live = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    const seen = driveSnaps(live, N); // no restoreRecordingEntry → defaults (FULL_HP, phase 0)
    expect(seen).not.toEqual(origSnaps);
  });
});

describe("restoreRecordingEntry — additive / back-compatible (safe no-op without entry data)", () => {
  it("a recording with NO entryState/entryRngCalls restores nothing (an older recording)", () => {
    const { rec } = recordL2();
    const stripped: RunRecording = { ...rec, entryState: undefined, entryRngCalls: undefined };
    const live = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    const before = snapshotWorld(live.world);
    const beforeRng = live.world.rngCalls;
    restoreRecordingEntry(live, stripped);
    expect(snapshotWorld(live.world)).toBe(before); // world untouched
    expect(live.world.rngCalls).toBe(beforeRng); // RNG untouched
  });

  it("a from-scratch entry-level recording (entryState just { level }, phase 0) restores harmlessly", () => {
    // Boot directly at level-2 and record from frame 0 — nothing was carried, so the entry is the slice
    // a fresh boot already establishes and the phase is 0. The restore is a no-op the run can't tell from
    // a plain boot.
    const recGame = createGame(raw, { canvas: null, registry: registry(), seed: SEED, record: true, entrySceneId: "level-2" });
    const origSnaps = driveSnaps(recGame, N);
    const rec = recGame.getRecording();
    expect(rec.entryState).toEqual({ level: 2 });
    expect(rec.entryRngCalls).toBe(0);

    const live = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    restoreRecordingEntry(live, rec);
    expect(driveSnaps(live, N)).toEqual(origSnaps); // identical to a plain boot+play
  });
});
