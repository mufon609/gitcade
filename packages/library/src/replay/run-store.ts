import type { RunRecording, StorageAdapter } from "@gitcade/sdk";

/**
 * The per-level RUN-STORE — the durable data layer the Echo, level-select, and race modes read.
 * Host-side CODE like the rest of `replay/` (it orchestrates storage round-trips, not a single Game's
 * tick): it registers no runtime type and adds no CATALOG entry, exactly like {@link ReplayIntro} /
 * {@link ScreenEffects}. It generalizes lumen's single per-level `run:<sceneId>` key into a reusable
 * store of, PER LEVEL: the LAST run's recording (the Echo source), the BEST run's recording (the
 * ghost/showcase, chosen by the game's {@link RunMetric}), the best TIME and best SCORE, and whether the
 * level has been cleared (the won-set).
 *
 * TWO STORAGE PLANES, by size and role:
 *
 *  1. **Recordings** — the big, opaque per-run blobs (`frames`, `entryState`, …). Stored as JSON values
 *     directly through the {@link StorageAdapter} (`world.storage`) under namespaced keys — `run:last:<id>`
 *     and `run:best:<id>` by default. They are NOT in `world.state`: a recording is far too large to ride
 *     the per-tick `world.state` snapshot the persistence system serializes, and nothing `bind`s to it.
 *
 *  2. **The progress INDEX** — the small, bindable per-level scalars: the won-set and the {@link LevelBest}
 *     numbers (ticks / seconds / score). Stored as ONE blob at {@link RunStoreOptions.slot}, in the EXACT
 *     shape the library `persistence` system round-trips: `{ [wonStateKey]: {<id>: true, …}, [bestStateKey]:
 *     {<id>: LevelBest, …} }`. So a game makes the index BINDABLE in its scenes with pure configuration —
 *     no extra host code — by pointing `manifest.persist` at the same slot and listing the two keys:
 *
 *     ```jsonc
 *     // game.json
 *     "persist": { "slot": "progress", "keys": ["runWon", "runBest"] }
 *     ```
 *
 *     On boot the `persistence` system loads that very blob into `world.state.runWon` / `world.state.runBest`,
 *     where a title / level-select scene `bind`s to it (just as Breakout binds its `best`). The run-store is
 *     the BETWEEN-RUNS writer of this slot; the persistence system is the IN-GAME reader. They never race:
 *     the run-store writes at run END (after the sim has stopped, so no more persistence ticks run), and the
 *     index is read-only during play (it changes only as a run outcome), so the in-tick save-on-change never
 *     fires for these keys. {@link recordRun} does a READ-MODIFY-WRITE of the slot, preserving any unrelated
 *     keys a game also persists there (a single `manifest.persist` slot is shared by all its persisted keys).
 *
 * DETERMINISM. Best TIME is the run's TICK COUNT (`recording.frameCount`) — the deterministic fixed-step
 * length of the run — and best SECONDS is `frameCount * recording.fixedDt`. Never `Date.now()` / wall-clock:
 * a recording byte-replays, so its tick count is the only replay-consistent notion of "how long the run took"
 * (a race mode that ranked on wall-clock could never rank a ghost it replays). The store reads no clock and
 * draws no RNG; it runs entirely outside the sim tick, so it cannot perturb determinism.
 *
 * SEMANTICS — TIME is a completion metric, SCORE stands alone:
 *  - best **time** updates only on a CLEARED run (`won: true`): an uncompleted run has no meaningful
 *    duration (a fast DEATH is not a fast clear), so losses never lower the best time. `ticks`/`seconds`
 *    stay `null` until the first clear.
 *  - best **score** updates on EVERY run: points accrue during play and a high-scoring loss is a legitimate
 *    high score (the arcade convention), so a loss can still set a new best score.
 *  - the **best recording** is the run that is best by the chosen {@link RunMetric}: the fastest CLEAR for
 *    `"fastest"`, or the highest-SCORE run (any outcome) for `"highScore"`.
 *  - the **won-set** accumulates: a level enters it on its first clear and never leaves.
 */

/**
 * Which run a game ranks as "best" — i.e. whose recording is kept as the level's {@link RunStore.bestRecording}
 * (the ghost a race mode replays / the showcase Echo). `"fastest"` keeps the fewest-tick CLEAR; `"highScore"`
 * keeps the highest-scoring run (any outcome). Best TIME and best SCORE are ALWAYS both tracked regardless —
 * the metric only decides which single recording is retained.
 */
export type RunMetric = "fastest" | "highScore";

/**
 * A level's best scalars — small, JSON, bindable. This is the per-level value in the progress index's
 * `bestStateKey` map; a game `bind`s a scene text sprite to a formatted view of it (Phase 4-5 UI).
 */
export interface LevelBest {
  /** Highest SCORE across ALL recorded runs of the level (wins and losses alike). */
  score: number;
  /**
   * Fewest TICKS among CLEARED runs — the best completion time, off the deterministic fixed-step.
   * `null` until the level has been cleared at least once (a loss has no completion time).
   */
  ticks: number | null;
  /** `ticks * fixedDt` — the best time in SECONDS (derived from {@link ticks}, never wall-clock). `null` until first clear. */
  seconds: number | null;
}

/** One finished run handed to {@link RunStore.recordRun}. */
export interface RunResult {
  /** The run's recording — the Echo/ghost source, and the carrier of `frameCount` (ticks) + `fixedDt` (→ time). */
  recording: RunRecording;
  /** The run's final SCORE (the game's score metric, e.g. motes / points). */
  score: number;
  /** Did the run CLEAR the level? Drives the won-set and gates the best-time update. */
  won: boolean;
  /**
   * The level (scene id) this run belongs to. Defaults to `recording.sceneId` — recordings are per-level
   * (a recording never spans a transition, see lumen's main.ts), so its scene id IS the level by construction.
   * Pass it explicitly only when a run's storage slot should differ from the recorded scene.
   */
  levelId?: string;
}

/** What a recorded run improved — so a UI can flash "NEW BEST!" without re-reading the store. */
export interface RecordOutcome {
  /** The level (scene id) the run was filed under. */
  levelId: string;
  /** The run set a new best SCORE. */
  newBestScore: boolean;
  /** The run set a new best TIME (a faster clear). */
  newBestTime: boolean;
  /** The run replaced the stored BEST recording (it is the new best by the chosen metric). */
  newBestRecording: boolean;
  /** The run newly added the level to the won-set (its FIRST clear). */
  newlyWon: boolean;
  /** The level's bests AFTER this run is folded in. */
  best: LevelBest;
}

/** The whole per-game progress index — what a level-select reads in ONE call. */
export interface RunProgress {
  /** Levels CLEARED at least once (accumulates; never shrinks). */
  won: Set<string>;
  /** Per-level bests, keyed by level (scene) id. Empty entry ⇒ never played. */
  best: Record<string, LevelBest>;
}

/** Options for {@link createRunStore}. Only `storage` is required; the rest default to lumen-compatible names. */
export interface RunStoreOptions {
  /** The persistence adapter — `world.storage` in a game, {@link MemoryStorage} in a test. */
  storage: StorageAdapter;
  /**
   * Which run is kept as the BEST recording. `"highScore"` (default) keeps the highest-scoring run;
   * `"fastest"` keeps the fewest-tick clear (the natural choice for a race / speedrun mode).
   */
  metric?: RunMetric;
  /** Storage-key builder for a level's LAST recording. Default `id => "run:last:" + id` (generalizes lumen's `run:<id>`). */
  lastKey?: (levelId: string) => string;
  /** Storage-key builder for a level's BEST recording. Default `id => "run:best:" + id`. */
  bestKey?: (levelId: string) => string;
  /** Storage slot holding the progress INDEX blob. Default `"progress"`. Point `manifest.persist.slot` here to bind it. */
  slot?: string;
  /** `world.state` key / index-blob field for the won-set map. Default `"runWon"`. List it in `manifest.persist.keys`. */
  wonStateKey?: string;
  /** `world.state` key / index-blob field for the per-level bests map. Default `"runBest"`. List it in `manifest.persist.keys`. */
  bestStateKey?: string;
}

/** The bound run-store surface (see {@link createRunStore}). All reads/writes go through the configured adapter. */
export interface RunStore {
  /** The metric this store ranks the best recording by (echoes {@link RunStoreOptions.metric}). */
  readonly metric: RunMetric;
  /**
   * Fold a finished run into the store: save its recording as the level's LAST, update best score / best
   * time / the won-set, and replace the BEST recording when this run is the new best by {@link metric}.
   * Returns what improved. Call once per finished run; runs are recorded sequentially (a run ends, then
   * this is called), so there is no concurrent read-modify-write of the index slot to guard.
   */
  recordRun(result: RunResult): Promise<RecordOutcome>;
  /** The whole progress index (won-set + per-level bests) in ONE read — what a level-select consumes. */
  loadProgress(): Promise<RunProgress>;
  /** A level's LAST run recording (the Echo source), or `null` if it has never been played. */
  lastRecording(levelId: string): Promise<RunRecording | null>;
  /** A level's BEST run recording (the ghost / showcase, by {@link metric}), or `null` if none qualifies yet. */
  bestRecording(levelId: string): Promise<RunRecording | null>;
  /** A level's best scalars, or `null` if never played. Convenience over {@link loadProgress} for one level. */
  bestFor(levelId: string): Promise<LevelBest | null>;
  /** Has this level been cleared at least once? Convenience over {@link loadProgress} for one level. */
  isWon(levelId: string): Promise<boolean>;
}

/** The progress index as it lives in the slot blob: two maps keyed by level id, plus any unrelated game keys. */
type WonMap = Record<string, true>;
type BestMap = Record<string, LevelBest>;
type IndexBlob = Record<string, unknown>;

/**
 * Build a {@link RunStore} over a {@link StorageAdapter}. See the module header for the data model and the
 * `manifest.persist` binding bridge. Stateless beyond its config — every method reads the latest from
 * storage, so two stores over the same adapter (or a reload) always agree; there is no cache to go stale.
 */
export function createRunStore(options: RunStoreOptions): RunStore {
  const storage = options.storage;
  const metric: RunMetric = options.metric ?? "highScore";
  const lastKey = options.lastKey ?? ((id: string) => `run:last:${id}`);
  const bestKey = options.bestKey ?? ((id: string) => `run:best:${id}`);
  const slot = options.slot ?? "progress";
  const wonStateKey = options.wonStateKey ?? "runWon";
  const bestStateKey = options.bestStateKey ?? "runBest";

  /** Read the index blob (or an empty one). Unknown keys are preserved on write so a shared persist slot is safe. */
  async function readIndex(): Promise<IndexBlob> {
    return ((await storage.get<IndexBlob>(slot)) as IndexBlob | null) ?? {};
  }
  const wonOf = (blob: IndexBlob): WonMap => ({ ...((blob[wonStateKey] as WonMap | undefined) ?? {}) });
  const bestOf = (blob: IndexBlob): BestMap => ({ ...((blob[bestStateKey] as BestMap | undefined) ?? {}) });

  return {
    metric,

    async recordRun(result: RunResult): Promise<RecordOutcome> {
      const levelId = result.levelId ?? result.recording.sceneId;
      const ticks = result.recording.frameCount; // the run's deterministic tick length
      const fixedDt = result.recording.fixedDt;
      const score = result.score;

      // PLANE 1 — always save the recording as this level's LAST run (the Echo source), won or lost.
      await storage.set(lastKey(levelId), result.recording);

      // PLANE 2 — fold the scalars into the progress index (read-modify-write, preserving unrelated keys).
      const blob = await readIndex();
      const wonMap = wonOf(blob);
      const bestMap = bestOf(blob);
      const prev = bestMap[levelId] as LevelBest | undefined;

      // SCORE: every run competes. TIME: only a CLEAR competes (a loss has no completion time).
      const newBestScore = !prev || score > prev.score;
      const prevTicks = prev?.ticks ?? null;
      const newBestTime = result.won && (prevTicks === null || ticks < prevTicks);

      const nextScore = newBestScore ? score : prev!.score;
      const nextTicks = newBestTime ? ticks : prevTicks;
      const nextSeconds = nextTicks === null ? null : nextTicks * fixedDt;
      const best: LevelBest = { score: nextScore, ticks: nextTicks, seconds: nextSeconds };
      bestMap[levelId] = best;

      const newlyWon = result.won && wonMap[levelId] !== true;
      if (result.won) wonMap[levelId] = true;

      // BEST recording: the run that is best by the chosen metric. "fastest" ⇒ the new fastest clear;
      // "highScore" ⇒ the new highest-scoring run. (For "fastest", newBestTime already requires a clear.)
      const newBestRecording = metric === "fastest" ? newBestTime : newBestScore;
      if (newBestRecording) await storage.set(bestKey(levelId), result.recording);

      blob[wonStateKey] = wonMap;
      blob[bestStateKey] = bestMap;
      await storage.set(slot, blob);

      return { levelId, newBestScore, newBestTime, newBestRecording, newlyWon, best };
    },

    async loadProgress(): Promise<RunProgress> {
      const blob = await readIndex();
      return { won: new Set(Object.keys(wonOf(blob))), best: bestOf(blob) };
    },

    async lastRecording(levelId: string): Promise<RunRecording | null> {
      return (await storage.get<RunRecording>(lastKey(levelId))) ?? null;
    },

    async bestRecording(levelId: string): Promise<RunRecording | null> {
      return (await storage.get<RunRecording>(bestKey(levelId))) ?? null;
    },

    async bestFor(levelId: string): Promise<LevelBest | null> {
      const blob = await readIndex();
      return (bestOf(blob)[levelId] as LevelBest | undefined) ?? null;
    },

    async isWon(levelId: string): Promise<boolean> {
      const blob = await readIndex();
      return wonOf(blob)[levelId] === true;
    },
  };
}
