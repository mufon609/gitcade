import type { Game, RunRecording } from "@gitcade/sdk";
import {
  ReplayIntro,
  attachReplayIntro,
  type ReplayIntroDoneInfo,
  type ReplayIntroVisuals,
} from "./replay-intro.js";

/**
 * The attract-LOOP wrapper over {@link attachReplayIntro}: replay the recorded "Echo" on REPEAT until
 * the player presses a key, and treat that keypress AS the start of live play (classic arcade attract
 * mode — the demo loops, "press any key" starts the game).
 *
 * Built ENTIRELY on the existing {@link ReplayIntro}/{@link attachReplayIntro} (it adds no replay
 * mechanics of its own): each cycle is a fresh {@link ReplayIntro} attached for one play-through, and
 * the loop reacts to that intro's conclusion —
 *  - **skip** (a key/pointer) → the keypress IS the start: tear the cycle down and fire `onStart` once.
 *  - **natural completion** (the Echo played out) → RE-ATTRACT: build a fresh seeded cycle and replay.
 *
 * Like {@link attachReplayIntro} this is host-side CODE, not a data-part — it orchestrates a Game + the
 * canvas loop + skip input, which a behavior/system cannot. It registers no runtime type and adds no
 * CATALOG entry.
 */

/** Construction options for {@link attachReplayLoop}. */
export interface ReplayLoopOptions {
  /**
   * Builds the replay Game for ONE cycle — called once per attract cycle so each replay runs in a
   * FRESH seeded world. Seed it with `recording.seed`, enter it at `recording.sceneId`, and build it
   * with `attachInput: false` (the watching player's keystrokes must not leak into the re-simulation).
   * A fresh game per cycle is what keeps every Echo byte-identical: a fixed-timestep run is a pure
   * function of seed + recorded input, so re-seeding reproduces the exact same playback every loop.
   */
  makeReplayGame: () => Game;
  /** The run to replay on every cycle (typically the player's last run, loaded via {@link parseRecording}). */
  recording: RunRecording;
  /** Fired EXACTLY ONCE when the player presses a skip key (or taps) — the keypress IS the start of live play. */
  onStart: () => void;
  /** Visual treatment + skip-input options, forwarded to {@link attachReplayIntro} on every cycle. */
  visuals?: ReplayIntroVisuals;
}

/**
 * Attach a looping {@link ReplayIntro} attract sequence to `canvas` and return an idempotent `stop()`.
 *
 * The loop starts immediately and runs until the player skips (→ `onStart`) or `stop()` is called.
 * `stop()` halts the loop and tears down the live cycle but does NOT fire `onStart` (it's a teardown,
 * not a skip) — mirroring {@link attachReplayIntro}'s own `stop()` contract.
 *
 * Headless / no animation clock: {@link attachReplayIntro} drives each cycle to completion
 * SYNCHRONOUSLY before returning, so a natural-completion re-cycle would recurse forever. Headless
 * therefore plays exactly ONE cycle and hands straight to `onStart` (a non-browser host can't watch
 * or skip an attract loop anyway) — it never loops and never strands `onStart`.
 */
export function attachReplayLoop(canvas: HTMLCanvasElement, opts: ReplayLoopOptions): () => void {
  const { makeReplayGame, recording, onStart, visuals } = opts;

  // The headless verdict, captured ONCE (the same probe {@link attachReplayIntro} uses). It decides
  // whether a natural completion re-attracts (browser) or hands straight to live (headless), so the
  // synchronous headless path can't recurse cycle-into-cycle.
  const headless = typeof requestAnimationFrame !== "function";

  let stopped = false; // the loop is over — torn down (stop) OR handed to live (onStart)
  let started = false; // onStart has fired (belt-and-suspenders so it fires at most once)
  let teardownCycle: () => void = () => {}; // tears down the CURRENT cycle's attachReplayIntro

  /** Fire `onStart` exactly once and end the loop (no further cycles). */
  function begin(): void {
    if (started) return;
    started = true;
    stopped = true;
    onStart();
  }

  /** Each cycle's conclusion: a skip starts live play; a natural finish re-attracts (loops). */
  function handleDone(info: ReplayIntroDoneInfo): void {
    if (stopped) return; // a stop() (or a prior begin) raced us — do nothing
    if (info.skipped) {
      // The keypress IS the start: tear this cycle's replay down, then go live (once).
      teardownCycle();
      begin();
    } else if (headless) {
      // No clock to loop on — one cycle has played; hand straight to live (never recurse, never strand).
      begin();
    } else {
      // Natural completion in the browser → re-attract: replay the Echo again from a fresh seeded world.
      runCycle();
    }
  }

  /** Start one attract cycle: a fresh seeded replay through a fresh {@link ReplayIntro}. */
  function runCycle(): void {
    if (stopped) return;
    const intro = new ReplayIntro({ game: makeReplayGame(), recording, onDone: handleDone });
    // attachReplayIntro renders + wires skip input for this cycle; its stop() tears the cycle down
    // between cycles. (Headless: this call drives the replay to completion and fires onDone INLINE,
    // before it returns — which is why `handleDone` must not re-cycle in the headless branch.)
    teardownCycle = attachReplayIntro(intro, canvas, visuals);
  }

  runCycle();

  return function stop(): void {
    if (stopped) return;
    stopped = true;
    teardownCycle();
  };
}
