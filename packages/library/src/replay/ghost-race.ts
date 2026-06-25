import { createReplay } from "@gitcade/sdk";
import type { Game, RunRecording, ReplayController, Entity, World } from "@gitcade/sdk";

/**
 * The GHOST / TIME-TRIAL host helper — sibling to {@link attachReplayIntro}, but where the intro and
 * live play are TEMPORALLY SEPARATE (the Echo plays, THEN live begins), a ghost race runs them
 * CONCURRENTLY: the player plays a level LIVE while a stored best run replays as a translucent "ghost"
 * on the SAME canvas, in LOCKSTEP (one ghost tick per live fixed-update). It is the substrate for
 * race / time-trial / score-attack against a previous run.
 *
 * TWO SEPARATE GAMES, one shared canvas. The live run is the player's new attempt (the caller's Game,
 * which the caller `start()`s). The ghost is a SECOND, headless, input-less Game driven by the SDK
 * {@link createReplay} primitive over a {@link RunRecording} from the run-store — self-contained
 * (P1/1b: it carries its own seed + entry-state + RNG phase), so it re-simulates byte-for-byte booted
 * in isolation. The ghost reads NOTHING from the live world and the live world reads nothing from the
 * ghost; the ONLY shared resource is the canvas, written render-only. So the ghost is INERT to the
 * live run's determinism: a live run recorded WITH a ghost attached replays identically to one without.
 *
 * Like the rest of `replay/` this is host-side CODE (it orchestrates a Game + the canvas loop), not a
 * data-part: it registers no runtime type and adds no CATALOG entry. Two halves, the established split:
 *  - {@link GhostRace} — a pure, DOM-free controller (headless-unit-testable): drives the ghost replay
 *    in lockstep with the live SIM and composites its chosen subset over the live frame.
 *  - {@link attachGhostRace} — thin browser glue: wires the controller onto the live Game's per-frame
 *    render seam ({@link Game.setFrameHook}) so the ghost paints right after the live world each frame.
 *
 * The compositing itself is the SDK's {@link Game.renderGhost} / `Renderer.renderOverlay`: draw the
 * ghost's chosen entities (default: the avatar, by tag) through the LIVE camera, OVER the live frame
 * without clearing it, translucent + optionally tinted. The ghost World still STEPS in full (so the
 * avatar's positions stay faithful); only the chosen subset is DRAWN, never the whole ghost world.
 */

/** Construction options for {@link GhostRace} / {@link attachGhostRace}. */
export interface GhostRaceOptions {
  /**
   * The LIVE game — the player's new attempt. The caller builds and `start()`s it; this helper only
   * wires a render-time overlay onto it (via {@link Game.setFrameHook}) and reads its camera + frame
   * counter. It is never mutated, so attaching a ghost cannot perturb the live run.
   */
  liveGame: Game;
  /**
   * The GHOST game — a SECOND Game the caller builds from the SAME sources, seeded with
   * `recording.seed`, entered at `recording.sceneId`, with `attachInput: false` (no input leak) and a
   * MUTED / headless audio player (no double SFX). Build it headless (`canvas: null`): its own renderer
   * is never used — the LIVE game's renderer draws the ghost — so it only needs to STEP. NOT started
   * (the controller drives it via `createReplay`).
   */
  ghostGame: Game;
  /** The stored run to replay as the ghost (typically `runStore.bestRecording(levelId)`). */
  recording: RunRecording;
  /**
   * Tag selecting which ghost entities are DRAWN — the avatar, so the ghost shows as one racer and not
   * a duplicate of every enemy/particle. Default `"player"`. Ignored if {@link filter} is given.
   */
  tag?: string;
  /** Explicit draw predicate, overriding {@link tag} (e.g. `e => e.hasTag("player") || e.hasTag("vehicle")`). */
  filter?: (e: Entity) => boolean;
  /** Ghost layer translucency in [0,1] — the "this is a ghost" wash. Default 0.45. */
  opacity?: number;
  /** Optional tint colorizing ONLY the ghost's pixels (isolated from the live frame). Default a cool cyan. */
  tint?: string;
  /** Tint strength in [0,1] (only with {@link tint}). Default 0.5. */
  tintAlpha?: number;
}

const DEFAULT_TAG = "player";
const DEFAULT_OPACITY = 0.45;
const DEFAULT_TINT = "#28d0ff"; // a cool cyan — reads as "a recording / a rival", distinct from live play
const DEFAULT_TINT_ALPHA = 0.5;

/**
 * The pure ghost-race controller. Owns the ghost replay (a {@link ReplayController} over a headless
 * Game) and composites its chosen subset over the live frame through the LIVE camera. Deterministic
 * and DOM-free — {@link attachGhostRace} is the browser glue that drives it from the live render loop.
 *
 * Lockstep is by the live SIM clock, not the render clock: {@link sync} advances the ghost to the
 * live game's fixed-update count (`liveGame.world.frame`), so the ghost is always at the same tick the
 * live world is — robust to a render frame running 0, 1, or N sim ticks. {@link draw} then paints it
 * at the same render-interpolation `alpha` the live frame used, so the ghost is as smooth as the view.
 */
export class GhostRace {
  /** The headless ghost Game (its World is the source of the drawn avatar). Exposed for tests/harness. */
  readonly ghostGame: Game;

  private readonly liveGame: Game;
  private readonly replay: ReplayController;
  private readonly filter: (e: Entity) => boolean;
  private readonly opacity: number;
  private readonly tint: string | undefined;
  private readonly tintAlpha: number;

  constructor(opts: GhostRaceOptions) {
    this.liveGame = opts.liveGame;
    this.ghostGame = opts.ghostGame;
    // Build the SDK replay driver UP FRONT — this validates `recording.schemaVersion` and THROWS on a
    // mismatch (and restores the recording's entry-state + RNG phase onto the ghost game), so a
    // stale/foreign recording fails loudly here rather than mis-replaying.
    this.replay = createReplay(opts.ghostGame, opts.recording);
    const tag = opts.tag ?? DEFAULT_TAG;
    this.filter = opts.filter ?? ((e) => e.hasTag(tag));
    this.opacity = opts.opacity ?? DEFAULT_OPACITY;
    this.tint = opts.tint ?? DEFAULT_TINT;
    this.tintAlpha = opts.tintAlpha ?? DEFAULT_TINT_ALPHA;
  }

  /** The ghost World — its entities are the faithful reconstruction of the recording at the current tick. */
  get ghostWorld(): World {
    return this.ghostGame.world;
  }

  /** Ticks the ghost has been stepped so far (`<= recording.frameCount`). */
  get ghostFrame(): number {
    return this.replay.frame;
  }

  /** True once the ghost has replayed every recorded tick (it then freezes at its final pose). */
  get done(): boolean {
    return this.replay.done;
  }

  /**
   * Advance the ghost replay forward to the live SIM tick `liveFrame` (lockstep catch-up) — one
   * recorded tick per step, bounded by the recording, so it never runs past the end. Stepping the
   * ghost mutates ONLY the ghost world; it never touches the live world, which is what keeps the ghost
   * inert to the live run's determinism. A no-op once the ghost is `done` or already at/past `liveFrame`.
   */
  sync(liveFrame: number): void {
    while (this.replay.frame < liveFrame && !this.replay.done) this.replay.step();
  }

  /**
   * Draw the ghost's chosen subset OVER the current live frame, through the LIVE camera, at render
   * interpolation `alpha` (the value the live frame was drawn with). No-op headless (the live game's
   * renderer has no context). Reads the ghost world + the live camera only — never mutates either.
   */
  draw(alpha = 1): void {
    this.liveGame.renderGhost(this.ghostWorld, {
      filter: this.filter,
      alpha,
      opacity: this.opacity,
      tint: this.tint,
      tintAlpha: this.tintAlpha,
    });
  }

  /**
   * One frame of the race: catch the ghost up to the live SIM tick, then composite it. This is exactly
   * what {@link attachGhostRace} calls from the live game's per-frame render hook — factored out so a
   * headless test can drive a race frame-by-frame with no rAF.
   */
  frame(alpha = 1): void {
    this.sync(this.liveGame.world.frame);
    this.draw(alpha);
  }
}

/** What {@link attachGhostRace} returns: the teardown plus the live controller (read its `ghostFrame`/`done`). */
export interface GhostRaceHandle {
  /** Detach the ghost overlay from the live game's render loop (clears its frame hook). Idempotent. */
  stop: () => void;
  /** The pure controller, for a host/harness that wants to read the ghost's progress. */
  race: GhostRace;
}

/**
 * Attach a ghost race to an ALREADY-RUNNING (or about-to-start) live game and return a teardown +
 * the controller. It wires the {@link GhostRace} onto the live game's per-frame render seam
 * ({@link Game.setFrameHook}): every frame, AFTER the live world is drawn, the ghost is caught up to
 * the live SIM tick and composited over the frame at the same interpolation alpha. The live game keeps
 * full ownership of its loop (input, pause, tab-hide, resize, audio) — the ghost just rides each frame.
 *
 * The race ENDS — the overlay detaches itself — as soon as the live game LEAVES the recorded level
 * (`liveGame.scene.id !== recording.sceneId`): a recording is per-level, so the level's own frame
 * count is the ghost clock, and there is nothing to draw over a different scene. `stop()` (returned)
 * also detaches at any time and is idempotent; it does NOT stop or mutate the live game.
 *
 * Headless / no animation clock: the live game's loop never runs (its `start()` requires
 * `requestAnimationFrame`), so the hook never fires — `attachGhostRace` is then just inert wiring that
 * returns a working `stop()`. Drive {@link GhostRace.frame} directly to exercise a race headless.
 */
export function attachGhostRace(opts: GhostRaceOptions): GhostRaceHandle {
  const race = new GhostRace(opts);
  const live = opts.liveGame;
  const raceScene = opts.recording.sceneId;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    live.setFrameHook(null);
  };

  live.setFrameHook((alpha) => {
    if (stopped) return;
    // The recording is per-level: once the live game advances/retries off the recorded scene, the
    // ghost has nothing meaningful to draw over — detach so a stale ghost can't linger on a new scene.
    if (live.scene.id !== raceScene) {
      stop();
      return;
    }
    race.frame(alpha);
  });

  return { stop, race };
}
