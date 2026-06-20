import type { Game } from "./game.js";
import type { World } from "./world.js";
import type { Input } from "./input.js";

/**
 * Determinism conformance — the harness that turns the engine's INTENDED determinism into a
 * PROVEN, checkable property. The runtime is a fixed-timestep simulation whose only entropy seam
 * is {@link World.rng}; given the same seed and the same per-frame input, two headless runs must
 * produce byte-identical world state. That is the foundation the reproducibility track (replays,
 * ghosts, seeded daily challenges, verifiable speedruns) is built on, so it is worth pinning down
 * mechanically rather than trusting by construction.
 *
 * Everything here is browser-safe (no Node built-ins) and purely ADDITIVE: it reads the public
 * runtime surface and introduces no new frozen shape. Use it from tests, and the Node validator
 * wraps it as a non-failing publish ADVISORY.
 *
 * Three pieces:
 *  - {@link seededRng} — the one canonical seedable PRNG (mulberry32). Pass it as `createGame`'s
 *    `rng` option to make a run reproducible: `createGame(src, { rng: seededRng(seed) })`.
 *  - {@link snapshotWorld} — a byte-stable serialization of the deterministic simulation state.
 *  - {@link runDeterminismCheck} / {@link assertDeterministic} — boot a game twice on the same
 *    seed + the same scripted input, step N frames, and confirm every frame matches.
 */

/**
 * The canonical seedable PRNG: mulberry32, a fast 32-bit generator that is more than adequate for
 * game randomness and — crucially — REPRODUCIBLE. The same seed always yields the same sequence, in
 * any JS engine. Pass it as the `rng` option when booting a game to make that run replayable:
 *
 *   const game = createGame(sources, { rng: seededRng(0x5eed) });
 *
 * The browser's `Math.random` (the {@link World} default) is correct for fresh, non-reproducible
 * play; reach for this whenever a run must reproduce — a replay, a ghost, a seeded challenge, a
 * headless test, or the determinism conformance check below.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Canonically serialize a JS value to a stable string: object keys are SORTED (so insertion order
 * never perturbs the output), numbers are formatted EXACTLY (full round-trip precision, with the
 * `-0` / `NaN` / `±Infinity` cases that `JSON.stringify` collapses kept DISTINCT so a real
 * divergence into one of them is never masked as equal). A cycle guard keeps a stray object
 * reference in `state` from throwing. This is what makes a snapshot comparison a true byte-identity
 * test rather than a lossy `JSON.stringify` one.
 */
function stable(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  const t = typeof value;
  if (t === "number") return numStr(value as number);
  if (t === "string") return JSON.stringify(value);
  if (t === "boolean") return value ? "true" : "false";
  if (t === "bigint") return `"${(value as bigint).toString()}n"`;
  if (t !== "object") return JSON.stringify(String(value)); // function/symbol — defensive
  const obj = value as object;
  if (seen.has(obj)) return '"[circular]"';
  seen.add(obj);
  let out: string;
  if (Array.isArray(obj)) {
    out = "[" + obj.map((v) => stable(v, seen)).join(",") + "]";
  } else {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    out =
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + stable((obj as Record<string, unknown>)[k], seen)).join(",") +
      "}";
  }
  seen.delete(obj);
  return out;
}

/** Exact, distinct string for a number — round-trip precision; `-0`/`NaN`/`±Infinity` kept apart. */
function numStr(n: number): string {
  if (Number.isNaN(n)) return '"NaN"';
  if (n === Infinity) return '"Infinity"';
  if (n === -Infinity) return '"-Infinity"';
  if (n === 0 && 1 / n === -Infinity) return '"-0"'; // Object.is(n,-0)
  return String(n); // shortest round-tripping decimal — deterministic for IEEE-754 doubles
}

/**
 * A byte-stable serialization of the DETERMINISTIC simulation state — everything the fixed-timestep
 * loop computes and a replay must reproduce, and NOTHING render-only or host-derived. Two worlds
 * that ran the same seed + the same input for the same frames produce the same string iff the
 * simulation stayed in lockstep.
 *
 * Captured: `frame`/`time`/`dt`; the game-wide `state` bag; the camera + bounds (camera offset is
 * render-applied but is WRITTEN deterministically from `world.rng` by `camera-shake`, so it doubles
 * as a strong RNG-desync canary); and, in ENTITY-ARRAY ORDER (the runtime's deterministic source of
 * truth — a reorder is itself a divergence we want to catch), each entity's transform, size,
 * velocity, opacity/visibility, layering, liveness, tags, animation playhead, `state` scratch,
 * parent link + local transform, physics-body contacts/drop-through, and this-tick collision
 * partners.
 *
 * Exported so tests and the validator advisory share ONE definition of "the state that must match".
 */
export function snapshotWorld(world: World): string {
  const entities = world.entities.map((e) => ({
    id: e.id,
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
    vx: e.vx,
    vy: e.vy,
    rotation: e.rotation,
    scaleX: e.scaleX,
    scaleY: e.scaleY,
    opacity: e.opacity,
    visible: e.visible,
    layer: e.layer,
    zIndex: e.zIndex,
    alive: e.alive,
    tags: [...e.tags].sort(),
    anim: { current: e.anim.current, frame: e.anim.frame, elapsed: e.anim.elapsed },
    state: e.state,
    parentId: e.parentId ?? null,
    local: e.local,
    body: {
      prevX: e.body.prevX,
      prevY: e.body.prevY,
      prevRotation: e.body.prevRotation,
      prevScaleX: e.body.prevScaleX,
      prevScaleY: e.body.prevScaleY,
      contacts: e.body.contacts,
      contactTick: e.body.contactTick,
      dropThrough: e.body.dropThrough,
      collider: e.body.collider ?? null,
    },
    // This-tick collision partners by id (the collision system is deterministic; order is a canary).
    collisions: e.collisions.map((c) => c.id),
  }));
  const cam = world.camera;
  return stable({
    frame: world.frame,
    time: world.time,
    dt: world.dt,
    state: world.state,
    bounds: world.bounds,
    camera: {
      x: cam.x,
      y: cam.y,
      width: cam.width,
      height: cam.height,
      shakeX: cam.shakeX ?? null,
      shakeY: cam.shakeY ?? null,
    },
    entities,
  });
}

/** Options for {@link runDeterminismCheck}. */
export interface DeterminismOptions {
  /** Seed handed to both runs' {@link seededRng}. Default `0x5eed`. */
  seed?: number;
  /** Fixed frames to step each run. Default 120. */
  frames?: number;
  /**
   * Per-frame input script, applied to `world.input` BEFORE each frame — IDENTICALLY in both runs
   * (so it must be a pure function of `frame`, mutating input only via {@link Input.setKey}/
   * {@link Input.tap}). It need not "play" the game; it exists to drive the input-reading code paths
   * in lockstep. Omit to run with no input.
   */
  script?: (input: Input, frame: number) => void;
}

/** The outcome of a {@link runDeterminismCheck}. */
export interface DeterminismReport {
  /** True iff every stepped frame matched byte-for-byte across the two runs. */
  deterministic: boolean;
  /** Frames stepped. */
  frames: number;
  /** 1-based frame at which the two runs first diverged (only when `!deterministic`). */
  divergedAtFrame?: number;
  /** The two diverging snapshots (only when `!deterministic`), for diffing. */
  diff?: { a: string; b: string };
}

/**
 * Boot a game TWICE via `makeGame` — once per run, each with a fresh `seededRng(seed)` — apply the
 * same per-frame input `script` to both, step `frames` fixed updates, and confirm the two runs stay
 * byte-identical at EVERY frame (so the report pinpoints the FIRST diverging frame, not just a final
 * mismatch). `makeGame` must build a FRESH game each call (it is invoked twice) and wire the passed
 * `rng` into it (`createGame(src, { rng })`); supplying the registry/custom behaviors is the
 * caller's job, which keeps this harness registry-agnostic — pure-SDK, library, and custom-part
 * games all flow through it unchanged.
 */
export function runDeterminismCheck(
  makeGame: (rng: () => number) => Game,
  opts: DeterminismOptions = {},
): DeterminismReport {
  const seed = opts.seed ?? 0x5eed;
  const frames = opts.frames ?? 120;
  const script = opts.script;

  const runOnce = (): string[] => {
    const game = makeGame(seededRng(seed));
    const snaps: string[] = [];
    for (let f = 0; f < frames; f++) {
      if (script) script(game.world.input, f);
      game.stepFrames(1);
      snaps.push(snapshotWorld(game.world));
    }
    return snaps;
  };

  const a = runOnce();
  const b = runOnce();
  for (let f = 0; f < frames; f++) {
    if (a[f] !== b[f]) {
      return { deterministic: false, frames, divergedAtFrame: f + 1, diff: { a: a[f], b: b[f] } };
    }
  }
  return { deterministic: true, frames };
}

/**
 * {@link runDeterminismCheck} as a test assertion: throws a precise error (the diverging frame +
 * a trimmed diff) when a game is non-deterministic, and returns silently when it is. The single
 * entry the conformance test suite calls per game/proof.
 */
export function assertDeterministic(
  makeGame: (rng: () => number) => Game,
  opts: DeterminismOptions = {},
): void {
  const r = runDeterminismCheck(makeGame, opts);
  if (r.deterministic) return;
  const a = r.diff?.a ?? "";
  const b = r.diff?.b ?? "";
  const at = firstDiffIndex(a, b);
  const ctx = (s: string): string => s.slice(Math.max(0, at - 40), at + 80);
  throw new Error(
    `non-deterministic: two runs (same seed + input) diverged at frame ${r.divergedAtFrame}/${r.frames}.\n` +
      `  run A …${ctx(a)}…\n` +
      `  run B …${ctx(b)}…`,
  );
}

/** Index of the first differing character between two strings (their length if one is a prefix). */
function firstDiffIndex(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/**
 * A deterministic, frame-derived input script for the conformance check (and the validator
 * advisory): it holds a rotating set of common movement keys, pulses `Space`, and taps a fixed
 * point on a cadence — all as a PURE FUNCTION of the frame index, so both runs receive byte-identical
 * input. It deliberately does not try to play any specific game well; identical input that merely
 * exercises the keyboard/pointer read paths is exactly what the check needs. A game that reads none
 * of these inputs is unaffected (the script can only ADD coverage, never cause a false divergence).
 */
export function scriptedConformanceInput(
  tapAt: { x: number; y: number } = { x: 64, y: 64 },
): (input: Input, frame: number) => void {
  const DIR = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyA", "KeyD", "KeyW", "KeyS"];
  return (input: Input, frame: number): void => {
    for (const k of DIR) input.setKey(k, false);
    input.setKey(DIR[Math.floor(frame / 11) % DIR.length], true); // one held direction, cycling
    input.setKey("Space", frame % 23 < 7); // periodic jump/flap/fire
    if (frame % 29 === 14) input.tap(tapAt.x, tapAt.y); // periodic tap edge
  };
}
