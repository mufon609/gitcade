import { createReplay } from "@gitcade/sdk";
import type { Game, RunRecording, ReplayController } from "@gitcade/sdk";

/**
 * The "replay intro" host helper — a skippable **Echo** of the player's last run, played back on the
 * canvas as a watchable intro before live play begins. It is built on the SDK's run-recording
 * primitive ({@link createReplay}): a fixed-timestep run is a pure function of its seed + per-frame
 * input, so a recorded run re-simulates byte-for-byte through a fresh seeded Game.
 *
 * WHY a host-side CODE export (like {@link ScreenEffects}/{@link LibraryAudioPlayer}), not a
 * data-part: the intro orchestrates a SECOND Game instance, the canvas rAF loop, and skip input —
 * none of which a behavior/system (frozen inside one Game's tick) can do. So it registers no runtime
 * type and adds no CATALOG entry. Two halves, the same split the FX module uses:
 *  - {@link ReplayIntro} — a pure, deterministic, DOM-free controller (unit-testable headless).
 *  - {@link attachReplayIntro} — the thin browser glue: an rAF loop that renders the replay + the
 *    echo treatment and wires skip input, and is a safe no-op (but never strands `onDone`) headless.
 *
 * Replay and live play are temporally SEPARATE — the intro plays a recording to completion (or is
 * skipped), THEN hands control back via `onDone`, at which point the caller starts the live game.
 */

/** What {@link ReplayIntro} reports to `onDone` when the intro concludes. */
export interface ReplayIntroDoneInfo {
  /** True if the player ended it early ({@link ReplayIntro.skip}); false if the replay played out fully. */
  skipped: boolean;
  /** The replay frame index it ended on — `recording.frameCount` on full completion, the current frame on skip. */
  atFrame: number;
}

/** Construction options for {@link ReplayIntro}. */
export interface ReplayIntroOptions {
  /**
   * The replay Game — built by the caller from the SAME sources as the live game, seeded with
   * `recording.seed` and entered at `recording.sceneId`, and NOT started (the controller drives its
   * `update`/`render`). Build it with `attachInput: false` so the watching player's keystrokes don't
   * leak into the re-simulation.
   */
  game: Game;
  /** The run to play back (typically the player's last run, loaded via {@link parseRecording}). */
  recording: RunRecording;
  /** Fired EXACTLY ONCE when the intro concludes (completion or skip) — the caller starts live play here. */
  onDone: (info: ReplayIntroDoneInfo) => void;
}

/**
 * The pure replay-intro controller. Drives an SDK {@link ReplayController} at the recording's own
 * fixed-timestep pace via a real-time accumulator (so playback matches the recorded wall-clock pace
 * regardless of the host frame rate), exposes a render-interpolation `renderAlpha`, and resolves
 * `onDone` exactly once. Deterministic and DOM-free — {@link attachReplayIntro} is the browser glue.
 */
export class ReplayIntro {
  /** The replay Game, exposed so the attacher can call `game.render(renderAlpha)`. */
  readonly game: Game;

  private readonly replay: ReplayController;
  private readonly onDone: (info: ReplayIntroDoneInfo) => void;
  /** The recorded fixed timestep — playback advances one recorded tick per `fixedDt` of real time. */
  private readonly fixedDt: number;
  /** Real time accumulated but not yet consumed by a whole fixed step — the render-interpolation base. */
  private accumulator = 0;
  /** Whether `onDone` has fired. The one-shot guard; {@link done} reflects it. */
  private finished = false;

  constructor(opts: ReplayIntroOptions) {
    this.game = opts.game;
    this.onDone = opts.onDone;
    // Build the SDK replay driver UP FRONT — this validates `recording.schemaVersion` and THROWS on a
    // mismatch, so a stale/foreign recording fails loudly at construction rather than mis-replaying.
    this.replay = createReplay(opts.game, opts.recording);
    this.fixedDt = opts.recording.fixedDt;
  }

  /** True once the intro has concluded and `onDone` has fired (via completion or skip). */
  get done(): boolean {
    return this.finished;
  }

  /** Playback fraction in `[0, 1]` (the {@link ReplayController}'s progress; `1` for an empty recording). */
  get progress(): number {
    return this.replay.progress;
  }

  /**
   * Leftover-accumulator fraction in `[0, 1)` — pass to `game.render(alpha)` for smooth render
   * interpolation between the last two replayed ticks (the same `accumulator / fixedDt` the live rAF
   * loop uses). The catch-up in {@link tick} drains the accumulator below `fixedDt`, so it stays in
   * range; clamped defensively so a post-completion read can't escape the interpolation interval.
   */
  get renderAlpha(): number {
    if (this.fixedDt <= 0) return 0;
    const a = this.accumulator / this.fixedDt;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /**
   * Advance playback by `dtSeconds` of real time. Fixed-timestep catch-up: bank the real dt and step
   * the replay one recorded tick per `fixedDt`, so playback tracks the recorded real-time pace at any
   * host frame rate. When the replay reaches its end, fire `onDone({ skipped: false })` exactly once.
   * A no-op once {@link done} (so a late rAF turn after the handoff does nothing).
   *
   * An EMPTY recording (`frameCount === 0`) is already exhausted, so the first `tick` completes it
   * immediately — `onDone({ skipped: false, atFrame: 0 })` — and the host goes straight to live play.
   */
  tick(dtSeconds: number): void {
    if (this.finished) return;
    if (dtSeconds > 0) this.accumulator += dtSeconds;
    // Drain whole fixed steps. The `!replay.done` guard is FIRST so this terminates (bounded by the
    // remaining frame count) regardless of the accumulated time — a step never runs past the end.
    while (!this.replay.done && this.accumulator >= this.fixedDt) {
      this.replay.step();
      this.accumulator -= this.fixedDt;
    }
    if (this.replay.done) this.finish(false);
  }

  /**
   * End the intro early (a skip key / pointer tap). Fires `onDone({ skipped: true, atFrame: <current> })`
   * exactly once; idempotent once {@link done}.
   */
  skip(): void {
    if (this.finished) return;
    this.finish(true);
  }

  /** Fire `onDone` exactly once — the single owner of the one-shot guard (completion AND skip route here). */
  private finish(skipped: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.onDone({ skipped, atFrame: this.replay.frame });
  }
}

/** Visual treatment + skip-input options for {@link attachReplayIntro}. */
export interface ReplayIntroVisuals {
  /** `KeyboardEvent.code` values that skip the intro. Default `["Space", "Enter", "Escape", "KeyG"]`. */
  skipKeys?: string[];
  /** Skip on a pointer tap on the canvas. Default `true`. */
  skipOnPointer?: boolean;
  /** Replay-wash tint color (the "this is an echo, not live" signal). Default a cool violet. */
  tint?: string;
  /** Tint alpha in `[0, 1]`. Default `0.18`. */
  tintAlpha?: number;
  /** Skip-prompt label; `null` draws none. Default `"▶ ECHO — press any key to skip"`. */
  prompt?: string | null;
  /** Draw a playback progress bar along the bottom edge. Default `true`. */
  progressBar?: boolean;
}

const DEFAULT_SKIP_KEYS = ["Space", "Enter", "Escape", "KeyG"];
const DEFAULT_TINT = "#4b3f8f"; // a cool violet wash — reads as "memory / echo", distinct from live play
const DEFAULT_TINT_ALPHA = 0.18;
const DEFAULT_PROMPT = "▶ ECHO — press any key to skip";

/**
 * Browser glue: run an rAF loop that ticks the {@link ReplayIntro}, draws the replay world + an echo
 * treatment (tint wash + skip prompt + progress bar) onto the canvas, and wires skip input (the
 * configured keys on `window`, plus a pointer tap on the canvas). The loop stops as soon as the intro
 * is done — at which point `onDone` has already fired and the caller typically started live play, so
 * the loop hands the canvas back WITHOUT drawing another replay frame (no replay-over-live flash).
 *
 * Returns an idempotent `stop()` that cancels the loop and removes the listeners. `stop()` does NOT
 * itself fire `onDone` (it's a teardown, not a skip).
 *
 * Headless / no animation clock: there's nothing to render and no input to skip with, so it just
 * drives the replay to completion (so `onDone` still resolves and a non-browser host skips straight
 * to live) and returns a `() => {}` — mirroring {@link attachScreenEffects}'s headless no-op, but
 * never stranding `onDone`.
 */
export function attachReplayIntro(
  intro: ReplayIntro,
  canvas: HTMLCanvasElement,
  visuals: ReplayIntroVisuals = {},
): () => void {
  const skipKeys = visuals.skipKeys ?? DEFAULT_SKIP_KEYS;
  const skipOnPointer = visuals.skipOnPointer ?? true;
  const tint = visuals.tint ?? DEFAULT_TINT;
  const tintAlpha = visuals.tintAlpha ?? DEFAULT_TINT_ALPHA;
  const prompt = visuals.prompt === undefined ? DEFAULT_PROMPT : visuals.prompt;
  const progressBar = visuals.progressBar ?? true;

  // No animation clock (headless / non-browser host): drive the replay to completion so `onDone`
  // resolves and the host proceeds to live play. `tick` makes guaranted progress each call and stops
  // at the end, so this loop terminates (bounded by the frame count); an empty recording ends in one.
  if (typeof requestAnimationFrame !== "function") {
    while (!intro.done) intro.tick(1);
    return () => {};
  }

  const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;

  // Skip input → intro.skip() (idempotent). The next rAF turn observes intro.done and tears down.
  const onKey = (e: KeyboardEvent): void => {
    if (skipKeys.includes(e.code)) intro.skip();
  };
  const onPointer = (): void => intro.skip();
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("keydown", onKey);
  }
  if (skipOnPointer && typeof canvas.addEventListener === "function") {
    canvas.addEventListener("pointerdown", onPointer);
  }

  let raf = 0;
  let stopped = false;
  let last = typeof performance !== "undefined" ? performance.now() : 0;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("keydown", onKey);
    }
    if (skipOnPointer && typeof canvas.removeEventListener === "function") {
      canvas.removeEventListener("pointerdown", onPointer);
    }
  };

  const loop = (now: number): void => {
    // Clamp dt the same way the live loop clamps `elapsed` — a tab-hide gap must not fast-forward the
    // whole replay on return. Negative (a clock skew) clamps to 0.
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    intro.tick(dt);
    // Done this turn → onDone already fired (live play is starting). Hand the canvas back without
    // painting another replay frame, so the live game owns the next paint cleanly.
    if (intro.done) {
      stop();
      return;
    }
    intro.game.render(intro.renderAlpha);
    if (ctx) drawTreatment(ctx, canvas, intro.progress, { tint, tintAlpha, prompt, progressBar });
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return stop;
}

/**
 * Draw the echo treatment over the just-rendered replay frame. Drawn in DEVICE pixels (the full
 * backing store) under a save/restore, so it covers the whole canvas regardless of the game's
 * logical→device transform and leaves that transform untouched for the next `game.render()`. Sizes
 * are fractions of the backing-store height, so the prompt/bar scale with the canvas resolution (DPR).
 */
function drawTreatment(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  progress: number,
  opts: { tint: string; tintAlpha: number; prompt: string | null; progressBar: boolean },
): void {
  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return;

  ctx.save();
  if (typeof ctx.setTransform === "function") ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 1) Tint wash — the "this is a replay, not live" signal.
  if (opts.tintAlpha > 0) {
    ctx.globalAlpha = Math.min(1, opts.tintAlpha);
    ctx.fillStyle = opts.tint;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // 2) Progress bar along the bottom edge (track + fill).
  if (opts.progressBar) {
    const barH = Math.max(2, Math.round(h * 0.012));
    const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(0, h - barH, w * p, barH);
  }

  // 3) Skip prompt, centered near the bottom (drop shadow for legibility over any scene).
  if (opts.prompt) {
    const fontPx = Math.max(10, Math.round(h * 0.035));
    ctx.font = `${fontPx}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const x = w / 2;
    const y = h - Math.round(h * 0.06);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(opts.prompt, x + 1, y + 1);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(opts.prompt, x, y);
  }

  ctx.restore();
}

/**
 * Safely parse a persisted recording string (the storage bridge stores a {@link RunRecording} as
 * JSON). Returns the recording when the string is valid JSON shaped like a v1 recording, or `null`
 * on ANY problem — malformed JSON, a missing/foreign `schemaVersion`, or a missing required field —
 * so a corrupt or stale blob simply means "no echo this run", never a thrown error mid-boot. (The
 * deep simulation invariants are still enforced downstream by `createReplay`; this is the cheap
 * front-door guard a host runs on the raw stored string.)
 */
export function parseRecording(json: string): RunRecording | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as Partial<RunRecording>;
  if (r.schemaVersion !== 1) return null;
  if (typeof r.sceneId !== "string") return null;
  if (typeof r.seed !== "number") return null;
  if (typeof r.fixedDt !== "number") return null;
  if (typeof r.frameCount !== "number") return null;
  if (!Array.isArray(r.frames)) return null;
  return parsed as RunRecording;
}
