import { describe, it, expect } from "vitest";
import {
  createGame,
  createReplay,
  createDefaultRegistry,
  snapshotWorld,
  MemoryStorage,
  type Game,
  type Registry,
  type BehaviorFn,
  type RawGameSources,
  type RunRecording,
} from "@gitcade/sdk";
import { createRunStore } from "../src/replay/index.js";

/**
 * 1.13.0 — {@link createRunStore}, the per-level RUN-STORE: the durable data layer the Echo, level-select,
 * and race modes read. It generalizes lumen's single `run:<sceneId>` key into, PER LEVEL: the LAST + BEST
 * recordings (raw JSON via the storage adapter), the won-set, and the best TIME / best SCORE (a small,
 * bindable progress index in the `manifest.persist` shape). These tests round-trip all of that through
 * {@link MemoryStorage} and pin the contract:
 *  - best SCORE is the max over ALL runs; best TIME is the fewest ticks among CLEARS only (a loss has no
 *    completion time) — and both update ONLY on improvement;
 *  - the won-set accumulates and never shrinks (losses don't unlock);
 *  - a recording survives the storage JSON round-trip and still drives a byte-for-byte {@link createReplay};
 *  - best TIME derives from the recording's TICK count (× fixedDt), never wall-clock;
 *  - the BEST recording follows the game's chosen {@link createRunStore} metric;
 *  - the index blob is in the persistence-system shape, and a shared `manifest.persist` slot is preserved.
 *
 * The fixture is a tiny INPUT-FREE, rng-driven two-level game: each tick the hero steps by `world.rng()`,
 * so per-tick snapshots are non-trivial and a faithful replay is a real assertion (not a no-op). Boot at a
 * level + step N ticks ⇒ a recording whose `frameCount` is N (the field the tests use to identify which run
 * a stored recording is).
 */

const SEED = 0xb0a7;

/** rng-driven, input-free hero — a deterministic seeded step each tick, so replays are byte-checkable. */
const rngDrift: BehaviorFn = (e, world) => {
  e.x += world.rng();
  e.y += world.rng() * 0.5;
};

function registry(): Registry {
  const r = createDefaultRegistry();
  r.registerBehavior("rng-drift", rngDrift);
  return r;
}

const manifest = {
  name: "Run Store Fixture",
  slug: "run-store",
  description: "Two-level fixture for the per-level run-store.",
  version: "1.0.0",
  engine: "gitcade-sdk",
  sdkVersion: "1.13.0",
  entryPoint: "src/scenes/level-1.json",
  tier: "open",
  levels: ["level-1", "level-2"],
};
const config = {};
const heroScene = (id: string): unknown => ({
  id,
  size: { width: 200, height: 200 },
  entities: [{ id: "hero", sprite: { kind: "none" }, size: { w: 8, h: 8 }, position: { x: 10, y: 10 }, behaviors: [{ type: "rng-drift", params: {} }] }],
  systems: [],
});
const raw: RawGameSources = { manifest, config, scenes: [heroScene("level-1"), heroScene("level-2")] };

/** Record a real run of `ticks` fixed steps booted at `sceneId`; returns the recording + its per-tick snapshots. */
function makeRecording(sceneId: string, ticks: number): { rec: RunRecording; snaps: string[] } {
  const g: Game = createGame(raw, { canvas: null, registry: registry(), seed: SEED, record: true, entrySceneId: sceneId });
  const snaps: string[] = [];
  for (let i = 0; i < ticks; i++) {
    g.stepFrames(1);
    snaps.push(snapshotWorld(g.world));
  }
  return { rec: g.getRecording(), snaps };
}

const FIXED_DT = makeRecording("level-1", 1).rec.fixedDt; // the engine's fixed timestep, constant across recordings

describe("createRunStore — per-level bests update only on improvement", () => {
  it("best score is the max over ALL runs; best time is the fewest ticks among CLEARS", async () => {
    const store = createRunStore({ storage: new MemoryStorage() });

    // A — a CLEAR (score 10, 50 ticks): sets both bests and the won-set.
    let o = await store.recordRun({ recording: makeRecording("level-1", 50).rec, score: 10, won: true });
    expect(o.newBestScore).toBe(true);
    expect(o.newBestTime).toBe(true);
    expect(o.newlyWon).toBe(true);
    expect(o.best).toEqual({ score: 10, ticks: 50, seconds: 50 * FIXED_DT });

    // B — a WORSE clear (score 5, 60 ticks): improves nothing.
    o = await store.recordRun({ recording: makeRecording("level-1", 60).rec, score: 5, won: true });
    expect(o.newBestScore).toBe(false);
    expect(o.newBestTime).toBe(false);
    expect(o.newlyWon).toBe(false);
    expect(o.best).toEqual({ score: 10, ticks: 50, seconds: 50 * FIXED_DT });

    // C — a higher-scoring LOSS (score 20, only 30 ticks): raises best SCORE but must NOT touch best TIME
    //     (a fast death is not a fast clear).
    o = await store.recordRun({ recording: makeRecording("level-1", 30).rec, score: 20, won: false });
    expect(o.newBestScore).toBe(true);
    expect(o.newBestTime).toBe(false); // 30 < 50, but it's a loss
    expect(o.best).toEqual({ score: 20, ticks: 50, seconds: 50 * FIXED_DT }); // ticks held at the clear's 50

    // D — a faster CLEAR (score 25, 40 ticks): lowers best TIME (and here also a new high score).
    o = await store.recordRun({ recording: makeRecording("level-1", 40).rec, score: 25, won: true });
    expect(o.newBestTime).toBe(true);
    expect(o.best).toEqual({ score: 25, ticks: 40, seconds: 40 * FIXED_DT });

    // The same values come back through a fresh read (durable, not just the returned outcome).
    expect(await store.bestFor("level-1")).toEqual({ score: 25, ticks: 40, seconds: 40 * FIXED_DT });
  });

  it("a level cleared only by a LOSS-free score keeps ticks null until the first clear", async () => {
    const store = createRunStore({ storage: new MemoryStorage() });
    const o = await store.recordRun({ recording: makeRecording("level-1", 22).rec, score: 8, won: false });
    expect(o.newBestScore).toBe(true);
    expect(o.newBestTime).toBe(false);
    expect(o.best).toEqual({ score: 8, ticks: null, seconds: null }); // no completion time yet
    expect(await store.isWon("level-1")).toBe(false);
  });
});

describe("createRunStore — the won-set accumulates", () => {
  it("accumulates across levels, never shrinks, and losses do not unlock", async () => {
    const store = createRunStore({ storage: new MemoryStorage() });

    await store.recordRun({ recording: makeRecording("level-1", 20).rec, score: 1, won: true });
    expect([...(await store.loadProgress()).won].sort()).toEqual(["level-1"]);

    await store.recordRun({ recording: makeRecording("level-2", 20).rec, score: 1, won: true });
    expect([...(await store.loadProgress()).won].sort()).toEqual(["level-1", "level-2"]);

    // A LOSS on a fresh level (explicit levelId override) does NOT add it to the won-set.
    await store.recordRun({ recording: makeRecording("level-2", 20).rec, score: 99, won: false, levelId: "level-3" });
    expect([...(await store.loadProgress()).won].sort()).toEqual(["level-1", "level-2"]);
    expect(await store.isWon("level-3")).toBe(false);

    // Re-clearing level-1 keeps it exactly once (set semantics) and reports it is not newly won.
    const again = await store.recordRun({ recording: makeRecording("level-1", 20).rec, score: 2, won: true });
    expect(again.newlyWon).toBe(false);
    expect([...(await store.loadProgress()).won].sort()).toEqual(["level-1", "level-2"]);
  });
});

describe("createRunStore — a stored recording survives the round-trip and stays replayable", () => {
  it("the LAST recording reloads byte-identical and drives a byte-for-byte createReplay", async () => {
    const store = createRunStore({ storage: new MemoryStorage() });
    const { rec, snaps } = makeRecording("level-1", 40);
    await store.recordRun({ recording: rec, score: 7, won: true });

    // Reload from storage — it round-tripped through the adapter's JSON ser/de.
    const loaded = await store.lastRecording("level-1");
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(rec); // structurally identical after the round-trip

    // Re-drive a FRESH seeded game at the recorded scene through the reloaded recording.
    const game: Game = createGame(raw, { canvas: null, registry: registry(), seed: loaded!.seed, entrySceneId: loaded!.sceneId });
    const replay = createReplay(game, loaded!);
    const replayed: string[] = [];
    while (!replay.done) {
      replay.step();
      replayed.push(snapshotWorld(game.world));
    }
    expect(replay.frame).toBe(rec.frameCount);
    expect(replayed).toEqual(snaps); // identical at every tick — the round-tripped recording reproduces the run
  });
});

describe("createRunStore — best TIME derives from ticks, never wall-clock", () => {
  it("best time is exactly frameCount ticks and frameCount * fixedDt seconds", async () => {
    const store = createRunStore({ storage: new MemoryStorage() });
    const { rec } = makeRecording("level-1", 33);

    const o = await store.recordRun({ recording: rec, score: 1, won: true });
    expect(o.best.ticks).toBe(33);
    expect(o.best.ticks).toBe(rec.frameCount);
    // SECONDS is an integer tick count times the fixed step — a value no wall-clock measurement could produce.
    expect(o.best.seconds).toBe(rec.frameCount * rec.fixedDt);

    // Wall-clock independence: re-folding the SAME run yields the identical time (a clock term would drift).
    const o2 = await store.recordRun({ recording: rec, score: 1, won: true });
    expect(o2.best.ticks).toBe(o.best.ticks);
    expect(o2.best.seconds).toBe(o.best.seconds);
  });
});

describe("createRunStore — the BEST recording follows the chosen metric", () => {
  it('"highScore" (default) keeps the highest-scoring run — even a loss', async () => {
    const store = createRunStore({ storage: new MemoryStorage(), metric: "highScore" });
    await store.recordRun({ recording: makeRecording("level-1", 50).rec, score: 10, won: true });

    // A higher-scoring LOSS becomes the best recording under highScore.
    const hi = await store.recordRun({ recording: makeRecording("level-1", 80).rec, score: 30, won: false });
    expect(hi.newBestRecording).toBe(true);
    expect((await store.bestRecording("level-1"))!.frameCount).toBe(80); // identified by its tick length

    // A lower-scoring later CLEAR does not replace the showcase.
    const lo = await store.recordRun({ recording: makeRecording("level-1", 20).rec, score: 5, won: true });
    expect(lo.newBestRecording).toBe(false);
    expect((await store.bestRecording("level-1"))!.frameCount).toBe(80);
  });

  it('"fastest" keeps the fewest-tick CLEAR; a faster loss is ignored', async () => {
    const store = createRunStore({ storage: new MemoryStorage(), metric: "fastest" });
    await store.recordRun({ recording: makeRecording("level-1", 50).rec, score: 1, won: true });
    expect((await store.bestRecording("level-1"))!.frameCount).toBe(50);

    // A faster LOSS must NOT become the fastest "clear".
    const loss = await store.recordRun({ recording: makeRecording("level-1", 20).rec, score: 99, won: false });
    expect(loss.newBestRecording).toBe(false);
    expect((await store.bestRecording("level-1"))!.frameCount).toBe(50);

    // A faster CLEAR replaces it.
    const fast = await store.recordRun({ recording: makeRecording("level-1", 35).rec, score: 1, won: true });
    expect(fast.newBestRecording).toBe(true);
    expect((await store.bestRecording("level-1"))!.frameCount).toBe(35);
  });
});

describe("createRunStore — the progress index is persistence-system shaped + durable", () => {
  it("writes the index in the manifest.persist slot shape (so scenes can bind it)", async () => {
    const storage = new MemoryStorage();
    const store = createRunStore({ storage }); // defaults: slot "progress", keys runWon/runBest
    const { rec } = makeRecording("level-1", 12);
    await store.recordRun({ recording: rec, score: 7, won: true });

    // The slot blob is exactly { runWon, runBest } — the shape the library `persistence` system loads into
    // world.state on boot, where a level-select scene binds to it (see the run-store module header).
    expect(await storage.get("progress")).toEqual({
      runWon: { "level-1": true },
      runBest: { "level-1": { score: 7, ticks: 12, seconds: 12 * rec.fixedDt } },
    });
  });

  it("honors custom slot/keys and preserves unrelated keys in a shared persist slot", async () => {
    const storage = new MemoryStorage();
    // A game also persists `currentLevel` in the SAME slot via manifest.persist.
    await storage.set("save", { currentLevel: "level-2" });
    const store = createRunStore({
      storage,
      slot: "save",
      wonStateKey: "cleared",
      bestStateKey: "records",
      lastKey: (id) => `rec:${id}`,
      bestKey: (id) => `rec:${id}:best`,
    });
    await store.recordRun({ recording: makeRecording("level-1", 10).rec, score: 3, won: true });

    const blob = (await storage.get("save")) as Record<string, unknown>;
    expect(blob.currentLevel).toBe("level-2"); // read-modify-write preserved the unrelated key
    expect(blob.cleared).toEqual({ "level-1": true });
    expect((blob.records as Record<string, { score: number }>)["level-1"].score).toBe(3);
    expect(await storage.get("rec:level-1")).not.toBeNull(); // custom last-recording key honored
  });

  it("a second store over the same storage sees prior progress (durable, no in-memory cache)", async () => {
    const storage = new MemoryStorage();
    await createRunStore({ storage }).recordRun({ recording: makeRecording("level-1", 15).rec, score: 9, won: true });

    const reopened = createRunStore({ storage });
    expect(await reopened.isWon("level-1")).toBe(true);
    expect((await reopened.bestFor("level-1"))!.score).toBe(9);
    expect((await reopened.lastRecording("level-1"))!.frameCount).toBe(15);
  });

  it("an empty store reports no progress and no recordings", async () => {
    const store = createRunStore({ storage: new MemoryStorage() });
    const p = await store.loadProgress();
    expect(p.won.size).toBe(0);
    expect(p.best).toEqual({});
    expect(await store.lastRecording("level-1")).toBeNull();
    expect(await store.bestRecording("level-1")).toBeNull();
    expect(await store.bestFor("level-1")).toBeNull();
    expect(await store.isWon("level-1")).toBe(false);
  });
});
