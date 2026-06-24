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
} from "../src/index.js";

/**
 * 1.13.0 — FAITHFUL ARBITRARY-LEVEL REPLAY (the two additive primitives that make any level
 * independently bootable AND byte-faithfully replayable):
 *
 *  1. `createGame(raw, { entrySceneId })` now HONORS an explicit entry scene that names a known scene
 *     (before, it always booted `manifest.entryPoint` and silently ignored the option). So a host can
 *     boot DIRECTLY at any level — a level-select, or replaying a mid-campaign level in isolation.
 *
 *  2. A {@link RunRecording} optionally carries `entryState` — a snapshot of `world.state` at the
 *     recording's first tick, the carried slice (carriedHp / motes / lives + the `level` index) the
 *     level was ENTERED with. {@link createReplay} restores it onto `world.state` BEFORE tick 0, so a
 *     level booted in isolation resumes from that carry instead of from defaults.
 *
 * Together these let a level-2 run that was ENTERED at partial hp be replayed by a fresh Game booted
 * straight at level-2 — no need to re-play level-1 — and still match the original byte-for-byte. The
 * control test proves the entry state is LOAD-BEARING: stripped, the isolation boot diverges on the
 * very first tick (a different starting hp → a different "damage" trajectory). Both are purely
 * additive: an old recording without `entryState` (and the default `entryPoint` boot) is unchanged.
 *
 * Determinism note: an isolation boot reproduces a level only when the seeded RNG is at the SAME
 * stream position at the level's entry. This fixture's level-1 consumes NO entropy (it has no
 * rng-reading parts), so the recorded level-2 run and a fresh isolation boot both enter level-2 with
 * the RNG at position 0 — the entry STATE (carriedHp) is then the only thing that must be restored.
 */

// --- A carry-dependent behavior: its per-tick trajectory is seeded from the entry world.state. ------
const FULL_HP = 3;
/**
 * Seeds `hp` from the carried `world.state.carriedHp` on its first tick (the mirror of a level pulling
 * a carried value off `world.state`), then couples that hp into the snapshot: hp scales an rng-driven
 * x-nudge, so a DIFFERENT starting hp produces a different per-tick trajectory from tick 0 — the
 * "damage outcome" that diverges when the entry state isn't restored. The rng is consumed the same
 * number of times per tick regardless of hp, so the rng STREAM stays in lockstep; only the snapshotted
 * values (x, y, hp) differ.
 */
const carriedHpBleeder: BehaviorFn = (e, world) => {
  if (e.state.hp === undefined) {
    e.state.hp = (world.state.carriedHp as number | undefined) ?? FULL_HP;
  }
  const hp = e.state.hp as number;
  e.x += world.rng() * hp; // hp scales the motion → entry state feeds the trajectory
  e.y += world.rng() * 0.5; // hp-independent, but keeps the rng stream advancing
  if (world.rng() < 0.15 && hp > 0) e.state.hp = hp - 1; // occasional seeded "damage"
};

function registry(): Registry {
  const r = createDefaultRegistry();
  r.registerBehavior("carried-hp-bleeder", carriedHpBleeder);
  return r;
}

// --- A minimal two-level campaign: level-1 carries `carriedHp`, level-2 reads it. -------------------
const manifest = {
  name: "Faithful Level Replay Fixture",
  slug: "faithful-level-replay",
  description: "Two-level fixture for isolation replay.",
  version: "1.0.0",
  engine: "gitcade-sdk",
  sdkVersion: "1.13.0",
  entryPoint: "src/scenes/level-1.json", // resolves to the "level-1" scene id
  tier: "open",
  levels: ["level-1", "level-2"],
};
const config = {};
// level-1: rng-free (so the RNG is untouched at the level-2 boundary) and declares the persist
// hand-off that carries `carriedHp` into level-2 — the only thing it needs to do for this fixture.
const level1 = {
  id: "level-1",
  size: { width: 200, height: 200 },
  entities: [],
  systems: [],
  flow: { persist: ["carriedHp"] },
};
// level-2: the carry-dependent hero, whose trajectory is seeded from the entered `carriedHp`.
const level2 = {
  id: "level-2",
  size: { width: 200, height: 200 },
  entities: [
    {
      id: "hero",
      sprite: { kind: "none" },
      size: { w: 8, h: 8 },
      position: { x: 20, y: 20 },
      behaviors: [{ type: "carried-hp-bleeder", params: {} }],
    },
  ],
  systems: [],
};
const raw: RawGameSources = { manifest, config, scenes: [level1, level2] };

const SEED = 0x1abe1;
const N = 72;
const PARTIAL_HP = 1; // level-2 is entered on a sliver of hp (full is FULL_HP = 3)

/** Drive `g` headless for `n` ticks (no input — the bleeder's rng advances state), collecting snapshots. */
function driveSnaps(g: Game, n: number): string[] {
  const snaps: string[] = [];
  for (let f = 0; f < n; f++) {
    g.stepFrames(1);
    snaps.push(snapshotWorld(g.world));
  }
  return snaps;
}

/**
 * Record a mid-campaign level-2 run entered at PARTIAL hp, the REAL way: boot level-1, stash a partial
 * `carriedHp`, advance one level (it carries via `flow.persist`), re-arm the recorder at level-2, then
 * drive + record. Returns the recording AND the per-tick snapshots of the original run, to compare.
 */
function recordLevel2FromCampaign(): { rec: RunRecording; origSnaps: string[] } {
  const g = createGame(raw, { canvas: null, registry: registry(), seed: SEED, record: true });
  expect(g.scene.id).toBe("level-1"); // booted the manifest entry point
  g.stepFrames(2); // a couple of level-1 ticks (rng-free)
  g.world.state.carriedHp = PARTIAL_HP; // the host stashes the partial hp before advancing
  g.requestNextLevel();
  g.stepFrames(1); // drain the queued transition → level-2 is active, carriedHp carried over
  expect(g.scene.id).toBe("level-2");
  g.resetRecording(); // re-arm: the next tick records as frame 0 in level-2 (entryState captured then)
  const origSnaps = driveSnaps(g, N);
  return { rec: g.getRecording(), origSnaps };
}

describe("createGame honors an explicit entrySceneId (primitive 1)", () => {
  it("boots DIRECTLY at a named scene, falling back to manifest.entryPoint otherwise", () => {
    // Default: no entrySceneId → the manifest entry point (level-1).
    expect(createGame(raw, { canvas: null, registry: registry() }).scene.id).toBe("level-1");
    // Explicit + known → honored (the old createGame ignored this and still booted level-1).
    expect(createGame(raw, { canvas: null, registry: registry(), entrySceneId: "level-2" }).scene.id).toBe("level-2");
    // Explicit + UNKNOWN → falls back to the manifest entry point (lenient, not a throw).
    expect(createGame(raw, { canvas: null, registry: registry(), entrySceneId: "no-such-scene" }).scene.id).toBe("level-1");
  });
});

describe("faithful arbitrary-level replay (entryState capture + restore, primitive 2)", () => {
  it("captures the entry state (carriedHp + level index) at the re-armed level-2 tick 0", () => {
    const { rec } = recordLevel2FromCampaign();
    expect(rec.sceneId).toBe("level-2"); // rooted where the re-armed recording's frame 0 was captured
    expect(rec.frameCount).toBe(N);
    expect(rec.entryState).toBeDefined();
    expect(rec.entryState!.carriedHp).toBe(PARTIAL_HP); // the carried slice the level was entered with
    expect(rec.entryState!.level).toBe(2); // the 1-based stage index loadScene stamped
  });

  it("replays via a fresh game booted DIRECTLY at level-2 — byte-for-byte (THE acceptance property)", () => {
    const { rec, origSnaps } = recordLevel2FromCampaign();

    // Boot the replay game straight at level-2 — the NEW createGame path. No level-1, no transition:
    // the level is replayed IN ISOLATION. createReplay restores rec.entryState (carriedHp=1) before tick 0.
    const replayGame = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    expect(replayGame.scene.id).toBe("level-2");
    const replay = createReplay(replayGame, rec);

    const seen: string[] = [];
    while (!replay.done) {
      replay.step();
      seen.push(snapshotWorld(replay.game.world));
    }
    expect(seen.length).toBe(origSnaps.length);
    expect(seen).toEqual(origSnaps); // byte-identical at every tick — faithful isolation replay
  });

  it("WITHOUT the restored entry state the isolation boot DIVERGES (proves entryState is load-bearing)", () => {
    const { rec, origSnaps } = recordLevel2FromCampaign();
    // Strip entryState → an "old-style" recording. Booted in isolation, world.state has no carriedHp,
    // so the hero seeds hp at FULL_HP instead of the carried 1 → a different damage trajectory.
    const stripped: RunRecording = { ...rec, entryState: undefined };
    const replayGame = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
    const replay = createReplay(replayGame, stripped);

    const seen: string[] = [];
    while (!replay.done) {
      replay.step();
      seen.push(snapshotWorld(replay.game.world));
    }
    expect(seen.length).toBe(origSnaps.length);
    expect(seen).not.toEqual(origSnaps); // diverged — the carried partial hp was lost without the restore
  });

  it("a from-scratch entry-level recording is INERT to entryState (present or stripped → same replay)", () => {
    // Boot directly at level-2 and record from frame 0 (no carry — a from-scratch entry-level run).
    // entryState is just { level: 2 }, which an isolation boot already establishes, so the restore is a
    // no-op. This is the default/back-compat path: the recording replays identically with or without it.
    const recGame = createGame(raw, { canvas: null, registry: registry(), seed: SEED, record: true, entrySceneId: "level-2" });
    const origSnaps = driveSnaps(recGame, N);
    const rec = recGame.getRecording();
    expect(rec.sceneId).toBe("level-2");
    expect(rec.entryState).toEqual({ level: 2 }); // no carriedHp — nothing was carried into a direct boot

    const replayWith = (recording: RunRecording): string[] => {
      const g = createGame(raw, { canvas: null, registry: registry(), seed: rec.seed, entrySceneId: "level-2" });
      const replay = createReplay(g, recording);
      const seen: string[] = [];
      while (!replay.done) {
        replay.step();
        seen.push(snapshotWorld(replay.game.world));
      }
      return seen;
    };

    expect(replayWith(rec)).toEqual(origSnaps); // entryState present → no-op restore, byte-identical
    expect(replayWith({ ...rec, entryState: undefined })).toEqual(origSnaps); // and an OLD recording (no field) replays the same
  });

  it("survives a JSON round-trip with entryState intact (the recording is plain JSON)", () => {
    const { rec, origSnaps } = recordLevel2FromCampaign();
    const rec2: RunRecording = JSON.parse(JSON.stringify(rec));
    expect(rec2.entryState).toEqual(rec.entryState); // carried through storage verbatim
    const replayGame = createGame(raw, { canvas: null, registry: registry(), seed: rec2.seed, entrySceneId: rec2.sceneId });
    const replay = createReplay(replayGame, rec2);
    const seen: string[] = [];
    while (!replay.done) {
      replay.step();
      seen.push(snapshotWorld(replay.game.world));
    }
    expect(seen).toEqual(origSnaps);
  });
});
