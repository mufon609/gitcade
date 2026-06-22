import type { Game } from "./game.js";
import type { Input } from "./input.js";

/**
 * Run recorder + replay driver — the substrate for ghost replays, seeded-challenge proofs, and
 * verifiable speedruns. It rests on the engine's one load-bearing property (see
 * {@link runDeterminismCheck}): a fixed-timestep run is a pure function of its seed and its
 * per-frame input. So a run is fully captured by `(seed, fixedDt, the per-tick input stream)`, and
 * re-driving a FRESH `seededRng(seed)` Game through that same input reproduces the original world
 * state BYTE-FOR-BYTE at every tick.
 *
 * Two halves, both browser-safe (no `node:` built-ins, exactly like {@link snapshotWorld}):
 *  - {@link RunRecorder} — sampled once per tick at the TOP of {@link Game.update} (guarded so a
 *    non-recording game is byte-identical). It READS input only — never mutates the world — so
 *    turning recording on cannot perturb the simulation. The {@link Game} owns one when built with
 *    `{ seed, record: true }`, surfaced via `getRecording()` / `resetRecording()`.
 *  - {@link createReplay} — drives a consumer-built seeded Game through a {@link RunRecording}, one
 *    tick per {@link ReplayController.step}, re-feeding the recorded input via
 *    {@link Input.setKey}/{@link Input.tap} BEFORE each `update`.
 *
 * SCOPE (v1): keyboard held-state + discrete pointer TAPS (a press/release edge at a point — the
 * {@link Input.tap} model). Full held-pointer / drag reproduction (pointer-follow, build-drag) is
 * intentionally OUT OF SCOPE — a platformer is keyboard + discrete taps, fully covered. See the
 * note on {@link RunRecorder.capture}.
 */

/** Recording-format schema version. Replay rejects a mismatch loudly rather than mis-replaying. */
const SCHEMA_VERSION = 1 as const;

/**
 * SDK version stamped into a recording as provenance ({@link RunRecording.sdkVersion}).
 * Keep in sync with this package's `package.json` "version". Browser-safe (a literal, not a
 * `package.json` read), so it ships in the runtime bundle.
 */
const SDK_VERSION = "1.13.0";

/**
 * One recorded tick of input, DELTA-encoded and SPARSE — an entry exists only on ticks that carry
 * a change (held-key set differs from the prior recorded frame) or a tap edge, plus frame 0 always.
 * `f` is the tick index BECAUSE the array is sparse (a dense array would key on the index).
 */
export interface RecordedFrame {
  /** 0-based tick index within the recording (the recorder's own monotonic counter). */
  f: number;
  /** Held `KeyboardEvent.code` values (sorted), present ONLY when changed from the prior recorded frame. */
  keys?: string[];
  /** Pointer tap-down edges (world coords) on this tick. Present only on ticks with a tap. */
  taps?: { x: number; y: number }[];
}

/**
 * A complete captured run: everything a fresh Game needs to reproduce it. Plain JSON (no class
 * instances, no `node:crypto`), so a game persists it through the storage bridge and reloads it
 * verbatim — `JSON.parse(JSON.stringify(rec))` replays identically.
 */
export interface RunRecording {
  /** Format version; {@link createReplay} throws on a mismatch. */
  schemaVersion: 1;
  /** Provenance: the SDK version that produced the run (advisory). */
  sdkVersion?: string;
  /** Entry scene the run started in — the consumer boots the replay Game with this. */
  sceneId: string;
  /** Seed the run used; replay rebuilds `seededRng(seed)` from it. */
  seed: number;
  /** Fixed timestep (s) the run advanced at; replay drives `update(fixedDt)`. */
  fixedDt: number;
  /** Total ticks recorded — {@link ReplayController.total}. */
  frameCount: number;
  /** Sparse, delta-encoded per-tick input. Frame 0 is always present (the initial held set, possibly `[]`). */
  frames: RecordedFrame[];
  /**
   * OPTIONAL integrity check: {@link snapshotWorld} of the world after the last tick (a STRING, not
   * a hash — browser-safe). The recorder does not stamp it (it samples at tick TOP, pre-tick); a
   * consumer sets it post-run and a replay confirms its final snapshot matches.
   */
  finalSnapshot?: string;
}

/**
 * Drives a {@link Game} through a {@link RunRecording}. The consumer owns the render/skip loop:
 * call {@link step} once per tick (re-applies that tick's input, then advances one fixed update),
 * and in the browser `game.render(alpha)` after each step on its own rAF; a headless test just
 * loops `while (!done) step()`.
 */
export interface ReplayController {
  /** The Game being driven (built by the consumer; see {@link createReplay}). */
  readonly game: Game;
  /** Apply this tick's recorded input (delta-applied held keys + injected taps), then `game.update(fixedDt)`. */
  step(): void;
  /** Ticks stepped so far. */
  readonly frame: number;
  /** Total ticks in the recording (`recording.frameCount`). */
  readonly total: number;
  /** True once every tick has been stepped (`frame >= total`). */
  readonly done: boolean;
  /** Playback fraction in `[0, 1]` (`frame / total`; `1` for an empty recording). */
  readonly progress: number;
}

/** Sorted-string-array equality — the held-key-set delta test. */
function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Accumulates a {@link RunRecording} as a {@link Game} ticks. The Game constructs one when built
 * with `{ seed, record: true }` and calls {@link capture} at the TOP of every {@link Game.update}.
 * Internal — the public surface is `Game.getRecording()` / `Game.resetRecording()` + the recording
 * format types.
 */
export class RunRecorder {
  private frames: RecordedFrame[] = [];
  /**
   * The recorder's OWN monotonic tick counter — NOT `world.frame`, which resets to 0 on every
   * `loadScene`. A recording therefore spans scene changes with a continuous frame index (a replay
   * follows the same flow, so it re-enters scenes on the same ticks).
   */
  private tick = 0;
  /** Last EMITTED held-key set, for the delta. `null` until frame 0 forces the first emit. */
  private lastHeld: string[] | null = null;
  /** Scene active when this buffer's frame 0 was captured; `null` until then (then a fallback is used). */
  private startSceneId: string | null = null;

  constructor(
    private readonly seed: number,
    private readonly fixedDt: number,
  ) {}

  /**
   * Sample one tick of input. Called at the TOP of {@link Game.update} (before any system/behavior
   * reads input, and before {@link Input.endFrame} clears the edge buffers), so it captures the
   * input as the tick BEGINS — exactly what the tick will act on. Pure-read: it copies the held set
   * and the tap-down edges and mutates nothing, so the simulation is byte-identical whether or not
   * a recorder is attached.
   *
   * Delta-encoding: `keys` is emitted only when the held set changed since the last recorded frame
   * (always on frame 0, with the initial set — possibly `[]`); `taps` only on ticks with a tap.
   * Taps are the PRESS (`justPressed`) edges: a discrete tap injected via {@link Input.tap} fills
   * both the press and release buffers at one point on one tick, so the press edge identifies it
   * once (capturing both buffers would double-count it), and replay re-injects via {@link Input.tap}
   * to restore both edges. Held-pointer / drag streams are out of scope.
   */
  capture(sceneId: string, input: Input): void {
    if (this.tick === 0) this.startSceneId = sceneId;
    const held = input.heldKeys(); // already a sorted copy
    const presses = input.justPressed();
    const keysChanged = this.lastHeld === null || !sameKeys(held, this.lastHeld);
    const hasTaps = presses.length > 0;
    if (keysChanged || hasTaps) {
      const frame: RecordedFrame = { f: this.tick };
      if (keysChanged) {
        frame.keys = held;
        this.lastHeld = held;
      }
      if (hasTaps) frame.taps = presses.map((p) => ({ x: p.x, y: p.y }));
      this.frames.push(frame);
    }
    this.tick += 1;
  }

  /** Clear the buffer + tick counter, staying armed — re-arms recording at a level boundary. */
  reset(): void {
    this.frames = [];
    this.tick = 0;
    this.lastHeld = null;
    this.startSceneId = null;
  }

  /**
   * A snapshot copy of the run captured so far. Copied deep enough (the frames array + each frame +
   * its `keys`/`taps` arrays) that the returned recording never mutates as the Game keeps ticking,
   * and a consumer can freely add `finalSnapshot` to it. `fallbackSceneId` is used only for an empty
   * buffer (no tick captured yet), where {@link startSceneId} has not been set.
   */
  toRecording(fallbackSceneId: string): RunRecording {
    return {
      schemaVersion: SCHEMA_VERSION,
      sdkVersion: SDK_VERSION,
      sceneId: this.startSceneId ?? fallbackSceneId,
      seed: this.seed,
      fixedDt: this.fixedDt,
      frameCount: this.tick,
      frames: this.frames.map((fr) => ({
        f: fr.f,
        ...(fr.keys ? { keys: fr.keys.slice() } : {}),
        ...(fr.taps ? { taps: fr.taps.map((t) => ({ x: t.x, y: t.y })) } : {}),
      })),
    };
  }
}

/**
 * Build a {@link ReplayController} that re-drives `game` through `recording` byte-for-byte. The
 * consumer constructs `game` from the SAME sources, seeded identically, and does NOT call
 * `game.start()` — the controller drives `update`/render:
 *
 * ```ts
 * const game = createGame(raw, { seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false });
 * const replay = createReplay(game, rec);
 * // browser: step on your own rAF and render between steps for a watchable, skippable intro
 * while (!replay.done) { replay.step(); game.render(); }
 * ```
 *
 * Validates `recording.schemaVersion` and throws on a mismatch — a recording from an incompatible
 * format must fail loudly, never silently mis-replay.
 */
export function createReplay(game: Game, recording: RunRecording): ReplayController {
  if (recording.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `createReplay: unsupported recording schemaVersion ${recording.schemaVersion} (this SDK reads ${SCHEMA_VERSION})`,
    );
  }
  return new ReplayDriver(game, recording);
}

/** The {@link ReplayController} implementation (private; consumers get the interface from {@link createReplay}). */
class ReplayDriver implements ReplayController {
  readonly game: Game;
  private readonly recording: RunRecording;
  private readonly input: Input;
  private _frame = 0;
  /** Cursor into the SPARSE `recording.frames` (ascending by `f`, the recorder's push order). */
  private cursor = 0;
  /** Keys currently held on the input — the delta base for {@link applyHeldKeys}. */
  private applied = new Set<string>();

  constructor(game: Game, recording: RunRecording) {
    this.game = game;
    this.recording = recording;
    this.input = game.world.input;
  }

  get frame(): number {
    return this._frame;
  }
  get total(): number {
    return this.recording.frameCount;
  }
  get done(): boolean {
    return this._frame >= this.recording.frameCount;
  }
  get progress(): number {
    const t = this.recording.frameCount;
    return t > 0 ? this._frame / t : 1;
  }

  step(): void {
    if (this.done) return; // past the end — idempotent no-op tail
    const frames = this.recording.frames;
    // Apply this tick's recorded input (when this sparse tick has an entry) BEFORE advancing the
    // sim — the same input-before-update order the live loop and the conformance harness use.
    if (this.cursor < frames.length && frames[this.cursor].f === this._frame) {
      const rec = frames[this.cursor++];
      if (rec.keys) this.applyHeldKeys(rec.keys);
      if (rec.taps) for (const t of rec.taps) this.input.tap(t.x, t.y);
    }
    this.game.update(this.recording.fixedDt);
    this._frame += 1;
  }

  /**
   * Reconstruct the held-key set from a delta frame: release every key we hold that's no longer in
   * the new set, press every newly-held key. A tick with no `keys` entry simply leaves the held set
   * as-is — the runtime's held set persists across ticks ({@link Input.endFrame} clears only the
   * one-tick edge buffers), so a carried set needs no re-application.
   */
  private applyHeldKeys(next: string[]): void {
    const nextSet = new Set(next);
    for (const code of this.applied) if (!nextSet.has(code)) this.input.setKey(code, false);
    for (const code of next) if (!this.applied.has(code)) this.input.setKey(code, true);
    this.applied = nextSet;
  }
}
