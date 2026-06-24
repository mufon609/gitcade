import type { Config } from "../schema/config.js";
import type { Scene } from "../schema/scene.js";
import { isReservedFlowTarget, type ReservedFlowTarget } from "../schema/scene.js";
import { resolveSceneInheritance } from "../schema/scene-inheritance.js";
import type { PersistConfig } from "../schema/manifest.js";
import { World } from "./world.js";
import { Registry } from "./registry.js";
import { Input } from "./input.js";
import { AudioPlayer, supportsMusic } from "./audio.js";
import type { StorageAdapter } from "../storage/adapters.js";
import { MemoryStorage } from "../storage/adapters.js";
import { buildEntity } from "./entity-factory.js";
import { resolveParams } from "./params.js";
import { Renderer } from "./renderer.js";
import { createDefaultRegistry } from "./defaults.js";
import type { ResolvedParams, SystemFn } from "./types.js";
import { LEVELS_COMPLETE, PAUSE_CHANGED } from "./channels.js";
import { seededRng } from "./determinism.js";
import { RunRecorder, type RunRecording } from "./replay.js";

/** Default fixed-update rate (60 Hz). */
export const DEFAULT_FIXED_DT = 1 / 60;
/** Max real-time consumed per frame, to prevent the spiral of death after a stall. */
const MAX_FRAME_SECONDS = 0.25;

export interface GameOptions {
  /** Parsed scene definitions (validate with `SceneSchema` first). */
  scenes: Scene[];
  /** Parsed `config.json`. */
  config: Config;
  /** Entry scene id; defaults to the first scene. */
  entrySceneId?: string;
  /** Behavior/system registry; defaults to all built-ins. Clone to extend. */
  registry?: Registry;
  /** Canvas to render to. `null`/omitted ⇒ headless (no rendering). */
  canvas?: HTMLCanvasElement | null;
  storage?: StorageAdapter;
  audio?: AudioPlayer;
  input?: Input;
  /** Deterministic RNG (defaults to `Math.random`). */
  rng?: () => number;
  /**
   * Seed for the canonical seeded RNG: when set, the engine builds its RNG as `seededRng(seed)` and
   * REMEMBERS the seed so a recording can replay it. MUTUALLY EXCLUSIVE with {@link rng} (a seed
   * names one specific stream; passing both throws). Omit for fresh, non-reproducible play.
   */
  seed?: number;
  /**
   * Record this run for replay (default false). REQUIRES {@link seed} — an unseeded run is not
   * reproducible, so recording one throws. When on, the Game accumulates a {@link RunRecording} as
   * it ticks, read via {@link Game.getRecording} / re-armed via {@link Game.resetRecording}.
   */
  record?: boolean;
  /** Fixed timestep in seconds (default 1/60). */
  fixedDt?: number;
  /** Attach DOM input listeners on start (default: true when a canvas is present). */
  attachInput?: boolean;
  /** Cross-run persistence binding (from `manifest.persist`); surfaced on `world.persist`. */
  persist?: PersistConfig;
  /**
   * Ordered level sequence (from `manifest.levels`). Enables the reserved
   * `flow.on` targets `"@next"`/`"@first"` and makes the runtime set
   * `world.state.level` to the active scene's 1-based position in this list.
   */
  levels?: string[];
  /** Scene to route to when `"@next"` advances past the last level (`manifest.levelsComplete`). */
  levelsComplete?: string;
  /**
   * Keys (`KeyboardEvent.code`) that toggle the manual pause. Detected in the
   * rAF loop — which keeps running while paused — so a frozen game can still be
   * UNpaused (a behavior/system can't, since it's frozen). Default: none.
   */
  pauseKeys?: string[];
  /**
   * Scene ids where {@link togglePause} may PAUSE; omit ⇒ any scene. Unpausing is
   * always allowed, so a pause can never be stranded by a scene change.
   */
  pauseScenes?: string[];
}

interface SystemInstance {
  type: string;
  fn: SystemFn;
  params: ResolvedParams;
  /**
   * This system instance's private per-tick-persistent store — the system-side analogue of
   * {@link BehaviorInstance.scratch}. Rebuilt fresh on every {@link Game.loadScene} (the systems
   * array is), so it is inherently scene-scoped: the clean home for an event-driven system's
   * once-per-scene `world.events.onScene` attach guard, replacing the old module-level WeakMap.
   */
  scratch: Record<string, unknown>;
}

/**
 * The game host: owns the world, the fixed-timestep loop, and rendering. The same
 * `Game` runs in the browser (`start()` drives a `requestAnimationFrame` loop) and
 * headless (`stepFrames(n)` runs pure simulation for tests and the validator).
 *
 * Fixed-update order per tick (deterministic):
 *   1. clear per-entity collision lists
 *   2. run systems in scene order (collision detection first)
 *   3. run each entity's behaviors in array order
 *   4. prune destroyed entities
 *   5. resolve dynamic bodies — push every `collider` out of the solid world (no-op when
 *      no entity has a collider, so the frozen 1–4 order is unchanged for every arcade scene)
 *   6. resolve the entity hierarchy — parented entities' world transforms (no-op when
 *      no entity has a parent, so the frozen 1–4 order is unchanged for a parentless scene)
 * Rendering happens once per animation frame, after the fixed-update catch-up loop, INTERPOLATED
 * between the last two ticks by the leftover-accumulator fraction so motion stays smooth when
 * the rAF rate doesn't divide the sim rate. Interpolation is render-only — the simulation is unchanged
 * and headless play (`stepFrames`, the validator/replays) never renders, so it stays byte-identical.
 */
export class Game {
  readonly world: World;
  readonly registry: Registry;
  scene: Scene;

  private readonly scenes: Map<string, Scene>;
  private readonly renderer: Renderer;
  private readonly fixedDt: number;
  private readonly attachInput: boolean;
  private readonly canvas: HTMLCanvasElement | null;
  /** The canvas 2D context (null headless / no-canvas) — held so {@link resize} can re-scale it. */
  private readonly ctx: CanvasRenderingContext2D | null;

  private systems: SystemInstance[] = [];
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private paused = false;
  /** True while a tab-hidden auto-pause is in effect and we should auto-resume on return. */
  private resumeAfterHide = false;
  private rafId: number | null = null;
  /** Teardown for the visibilitychange listener installed by start(). */
  private detachLifecycle: (() => void) | null = null;
  /** Pause-toggle keys + the guard scene set + the loop's edge-detect state. */
  private readonly pauseKeys: string[];
  private readonly pauseScenes: string[] | null;
  private pauseKeyWasDown = false;
  /** Unsubscribers for the active scene's `flow.on` event edges, torn down on scene change. */
  private flowUnsubs: Array<() => void> = [];
  /** Ordered level sequence + completion target; empty list ⇒ no campaign concept. */
  private readonly levels: string[];
  private readonly levelsComplete?: string;
  /** Run recorder when built with `{ seed, record: true }`; `null` ⇒ not recording (byte-identical path). */
  private readonly recorder: RunRecorder | null = null;

  constructor(opts: GameOptions) {
    if (opts.scenes.length === 0) throw new Error("Game requires at least one scene");
    // Resolve scene inheritance BEFORE indexing, so the map, the entry scene,
    // and every transition see fully-merged scenes — `extends` is invisible past here.
    const scenes = resolveSceneInheritance(opts.scenes);
    this.scenes = new Map(scenes.map((s) => [s.id, s]));
    this.levels = opts.levels ?? [];
    this.levelsComplete = opts.levelsComplete;
    const entry = opts.entrySceneId
      ? this.scenes.get(opts.entrySceneId)
      : scenes[0];
    if (!entry) throw new Error(`entry scene "${opts.entrySceneId}" not found`);
    this.scene = entry;

    this.registry = opts.registry ?? createDefaultRegistry();
    this.fixedDt = opts.fixedDt ?? DEFAULT_FIXED_DT;
    this.canvas = opts.canvas ?? null;
    this.attachInput = opts.attachInput ?? this.canvas != null;
    this.pauseKeys = opts.pauseKeys ?? [];
    this.pauseScenes = opts.pauseScenes ?? null;

    // Seed / RNG / recording — all opt-in and default-off, so a game that sets none is byte-identical
    // to today. A `seed` builds the canonical seeded RNG and is REMEMBERED so a recording can replay
    // it; it is mutually exclusive with a custom `rng` (a seed names one specific stream). `record`
    // accumulates a replay of this run and REQUIRES a seed — an unseeded run can't reproduce.
    if (opts.seed !== undefined && opts.rng) {
      throw new Error("Game: `seed` and `rng` are mutually exclusive (a seed builds seededRng(seed))");
    }
    if (opts.record && opts.seed === undefined) {
      throw new Error("Game: `record: true` requires a `seed` — an unseeded run is not reproducible");
    }
    const rng = opts.seed !== undefined ? seededRng(opts.seed) : opts.rng;
    this.recorder = opts.record ? new RunRecorder(opts.seed!, this.fixedDt) : null;

    this.world = new World({
      // WORLD bounds = the entry scene's `world` (the scrollable area) or its `size`
      // (viewport) when unset. loadScene re-applies this per scene + sets the
      // camera viewport; this initial value just keeps a freshly-built world coherent.
      bounds: {
        width: (this.scene.world ?? this.scene.size).width,
        height: (this.scene.world ?? this.scene.size).height,
      },
      config: opts.config,
      registry: this.registry,
      input: opts.input,
      audio: opts.audio,
      storage: opts.storage ?? new MemoryStorage(),
      rng,
      persist: opts.persist,
    });

    const ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.ctx = ctx;
    // Size the canvas backing store for the first frame (see {@link resize}); start() then re-runs it on
    // layout resize + DPR change so it never goes stale.
    this.resize();
    this.renderer = new Renderer(ctx);

    this.loadScene(this.scene.id);
  }

  /**
   * Build the world for a scene id (entities + resolved systems).
   *
   * Preserves an explicit `persist` set across the transition instead of always
   * wiping `world.state`. The preserved keys are the LEAVING scene's `flow.persist`
   * plus any `opts.keepExtra` (the per-hop `requestScene({ keep })` set). With
   * neither — a scene with no `flow` whose host callers pass no `keepExtra` — the
   * keep set is empty and this is a full wipe.
   */
  /**
   * Drive the active scene's declarative `scene.music` through the audio player. A music-capable player
   * (see {@link supportsMusic} — the library's player is one; the SDK's primitive player is not) starts
   * the named track, or stops music when the scene names none; a same-track re-entry is a no-op in the
   * player, so transitions between scenes sharing a track don't restart it. Music is a side effect
   * OUTSIDE the simulation snapshot, so this never affects determinism, and a primitive/headless player
   * no-ops it — a scene without `music` on a music-capable player goes silent; otherwise nothing changes.
   */
  private applySceneMusic(scene: Scene): void {
    const audio = this.world.audio;
    if (!supportsMusic(audio)) return;
    if (scene.music) audio.startMusic(scene.music);
    else audio.stopMusic();
  }

  loadScene(sceneId: string, opts?: { keepExtra?: string[] }): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error(`scene "${sceneId}" not found`);

    // Carry the kept slice of state across the transition. prevPersist comes
    // from the scene we are LEAVING; keepExtra from the requesting part.
    const prevPersist = this.scene?.flow?.persist ?? [];
    const keep = new Set([...prevPersist, ...(opts?.keepExtra ?? [])]);
    const carried: Record<string, unknown> = {};
    for (const k of keep) if (k in this.world.state) carried[k] = this.world.state[k];

    this.scene = scene;
    // Drive the scene's declarative `scene.music` (a no-op on a player without a music channel, and
    // outside the sim snapshot — so headless/determinism are unaffected).
    this.applySceneMusic(scene);

    // Tear down the previous scene's flow edges before installing this scene's, so
    // re-entering a scene never accumulates duplicate listeners on the shared bus.
    for (const off of this.flowUnsubs) off();
    this.flowUnsubs = [];
    // Drop every SCENE-SCOPED event listener (world.events.onScene) the same way —
    // the engine generalization of the per-part "attach once" WeakMap dedup, so an
    // event-driven system re-attaching on "Play again" can't double-fire. Game-lifetime
    // `on` listeners (the flow edges torn down just above, host glue) are untouched.
    this.world.events.clearSceneListeners();

    // Reset world contents, then restore the kept slice. resetEntities() clears the entity array
    // AND the id/tag indexes together (a raw `entities = []` would leave the prior scene's tag
    // buckets stale); the per-entity add() loop below repopulates all three in lockstep.
    this.world.resetEntities();
    for (const key of Object.keys(this.world.state)) delete this.world.state[key];
    Object.assign(this.world.state, carried);
    // Unify the difficulty counter with the stage index: when the entered
    // scene is part of the manifest's `levels` sequence, `world.state.level` is its
    // 1-based position. So advancing a stage bumps the same `level` that
    // `scale-by-state`/`level-progression` read — a per-stage difficulty ramp comes
    // for free, with no per-scene config. Games without `levels` never see this key.
    const levelIdx = this.levels.indexOf(scene.id);
    if (levelIdx >= 0) this.world.state.level = levelIdx + 1;
    // The persistence-restore tracking (the claim set + the restored set/waiters)
    // is scene-scoped — the active scene owns its persistence/seed systems — so reset
    // it on every transition. Using the dedicated reset (not resolvePersistKeys) means
    // a scene change does NOT emit a spurious "persist-restored" for leftover claims.
    this.world.resetPersistTracking();
    // Pending one-shot timers (`world.after`) are scene-scoped: drop them so a timer armed in
    // the leaving scene can never fire into the entered one (the cross-scene-leak class).
    this.world.clearScheduled();
    // Logical-action bindings/overrides are scene-scoped too: the active scene
    // owns its `input-actions` system, which re-installs them on its first tick.
    this.world.input.resetActions();
    this.world.tilemap = scene.tilemap;
    // Decouple WORLD bounds from the VIEWPORT. `scene.size` is the viewport
    // the canvas shows; `scene.world` (optional) is the larger simulation area a
    // camera pans across. Behaviors clamp/floor against `world.bounds`; the camera
    // viewport size is the canvas size; pointer→world mapping stays in viewport space.
    // Reset the camera to the origin on every scene load (a new level starts top-left;
    // a `camera-follow` system repositions it on tick 1). With no `scene.world`,
    // bounds == viewport and the camera sits at {0,0}. NOTE: the canvas
    // backing store is sized once from the ENTRY scene, so a game's scenes should share
    // one viewport size (`scene.size`); only the world bounds vary per level.
    const viewport = scene.size;
    const worldSize = scene.world ?? scene.size;
    this.world.bounds.width = worldSize.width;
    this.world.bounds.height = worldSize.height;
    this.world.camera = { x: 0, y: 0, width: viewport.width, height: viewport.height };
    this.world.input.setWorldSize(viewport.width, viewport.height);
    this.world.frame = 0;
    this.world.time = 0;
    this.accumulator = 0;

    for (const def of scene.entities) {
      this.world.add(buildEntity(def, this.registry, this.world.config));
    }

    this.systems = scene.systems.map((s) => {
      const reg = this.registry.getSystem(s.type);
      if (!reg) throw new Error(`unknown system type "${s.type}"`);
      return {
        type: s.type,
        fn: reg.fn,
        params: resolveParams(s.params, this.world.config),
        scratch: {}, // fresh per scene load → the system's scene-scoped private store
      };
    });

    // Install the data-driven flow edges: emitting `evt` queues a transition to
    // `target` (drained between ticks, like any requestScene). No host JS needed.
    // A reserved token (`@next`/`@first`) is resolved against `levels` at emit
    // time so a level never hard-wires its successor.
    for (const [evt, target] of Object.entries(scene.flow?.on ?? {})) {
      this.flowUnsubs.push(
        this.world.events.on(evt, () => {
          const dest = isReservedFlowTarget(target) ? this.resolveLevelTarget(target) : target;
          if (dest) this.world.requestScene(dest);
        }),
      );
    }
  }

  /**
   * Resolve a reserved level-sequence flow target against `manifest.levels`,
   * keyed on the ACTIVE scene. `"@first"` ⇒ the first level. `"@next"` ⇒ the level
   * after the active one, or `levelsComplete` past the last, or the first level when
   * emitted from a non-level scene (a title/menu "start" edge). Returns `null` (a
   * no-op transition) when there is no level sequence or no resolvable destination —
   * e.g. clearing the last level with no `levelsComplete` set, which instead emits a
   * `"levels-complete"` event so a host/part can react.
   */
  private resolveLevelTarget(token: ReservedFlowTarget): string | null {
    if (this.levels.length === 0) return null;
    if (token === "@first") return this.levels[0];
    const here = this.levels.indexOf(this.scene.id);
    if (here < 0) return this.levels[0];
    const next = this.levels[here + 1];
    if (next) return next;
    if (this.levelsComplete) return this.levelsComplete;
    LEVELS_COMPLETE.emit(this.world, { levels: this.levels.length });
    return null;
  }

  /**
   * Advance to the next level in the manifest sequence — the programmatic
   * companion to the `"@next"` flow token, for a host driving progression directly.
   * Queues the transition like any {@link World.requestScene}; no-op without a
   * resolvable next level.
   */
  requestNextLevel(): void {
    const dest = this.resolveLevelTarget("@next");
    if (dest) this.world.requestScene(dest);
  }

  /** Run exactly one fixed-update step. */
  update(dt: number): void {
    // Record this tick's input at the very TOP — the held-key set + tap-down edges as the tick
    // BEGINS, before any system/behavior consumes them and before endFrame() clears the edges. On the
    // recording's first tick the recorder also deep-copies `world.state` here (pre-tick) as the level's
    // entry state. The recorder reads input + state only (no world mutation), and the whole step is
    // guarded so a non-recording game does no read and no allocation — byte-identical to today.
    if (this.recorder) this.recorder.capture(this.scene.id, this.world.input, this.world.state);

    this.world.dt = dt;
    this.world.frame += 1;
    this.world.time += dt;

    // Snapshot the camera's pre-tick position (for render interpolation) BEFORE systems run — a
    // `camera-follow` system moves it this tick, so this captures its start so the renderer can lerp the
    // scroll base between ticks. Render-only; the simulation never reads it (headless stays byte-identical).
    this.world.camera.prevX = this.world.camera.x;
    this.world.camera.prevY = this.world.camera.y;

    // Snapshot each entity's pre-tick RENDER TRANSFORM (position + rotation + scale) and clear its
    // collision list in one pass. `body.prevX`/`body.prevY` let a carry behavior read a moving solid's
    // per-tick world delta (`x - body.prevX`) later this tick; the whole snapshot (incl. rotation/scale)
    // is what the renderer interpolates between the last two ticks, so a spinning/scaling entity stays
    // smooth and not just a translating one. Clearing collisions readies the list for this tick's
    // detection. (Done together to avoid a second full sweep of the entity array.)
    for (const e of this.world.entities) {
      e.body.prevX = e.x;
      e.body.prevY = e.y;
      e.body.prevRotation = e.rotation;
      e.body.prevScaleX = e.scaleX;
      e.body.prevScaleY = e.scaleY;
      if (e.collisions.length) e.collisions.length = 0;
    }

    for (const sys of this.systems) sys.fn(this.world, sys.params, dt, sys.scratch);

    // Snapshot to keep iteration stable if a behavior spawns/destroys.
    const entities = this.world.entities.slice();
    for (const e of entities) {
      if (!e.alive) continue;
      for (const b of e.behaviors) b.fn(e, this.world, b.params, dt, b.scratch);
    }

    // Fire any one-shot timers due this tick (the `world.after` scheduler), after the whole
    // behavior pass and BEFORE prune — so a timer that spawns/destroys is pruned and resolved in
    // the same tick. No-op fast path when nothing is scheduled, so a timer-free game is byte-identical.
    this.world.runScheduled();

    this.world.prune();
    // Resolve every dynamic body against the solid world (the unified collision phase): push
    // dynamic colliders out of solid tiles + solid entities, in one owned pass. Appended after
    // prune, BEFORE resolveHierarchy (so a parented child follows a RESOLVED parent) — it does NOT
    // reorder the frozen 1–4 in-tick sequence, and no-ops entirely when no entity has a collider,
    // so an arcade scene is byte-identical.
    this.world.resolveBodies();
    // Resolve the entity hierarchy (the scene graph): derive each parented entity's WORLD
    // transform from its parent's settled position THIS tick. Appended after prune (operates on
    // live entities) — it does NOT reorder the frozen 1–4 in-tick sequence, and no-ops entirely
    // when no entity has a parent, so a parentless scene renders byte-identically.
    this.world.resolveHierarchy();
    this.world.events.clear();
    // Clear the one-frame pointer edge buffers — an edge lives exactly one tick.
    this.world.input.endFrame();

    // Drain a queued scene change AFTER the tick. Doing it here — not in
    // start()'s rAF loop — means every caller (rAF, stepFrames, the harness/validator
    // driving update() directly) observes transitions, and the switch never happens
    // mid-tick, so the frozen in-tick order is untouched. A transition takes effect
    // on the NEXT update (deterministic).
    const req = this.world.takePendingScene();
    if (req) this.loadScene(req.to, { keepExtra: req.keep });
  }

  /** Run `n` fixed-update steps with no rendering (headless tests / validator boot). */
  stepFrames(n: number): void {
    for (let i = 0; i < n; i++) this.update(this.fixedDt);
  }

  /**
   * The run captured so far, as a snapshot copy — only when this Game was built with
   * `{ seed, record: true }`. Replay it through a fresh seeded Game via {@link createReplay} (boot
   * it with `recording.sceneId` + `recording.seed`). Throws if recording was not enabled (asking for
   * a recording you didn't arm is a usage error, not an empty result).
   */
  getRecording(): RunRecording {
    if (!this.recorder) {
      throw new Error("Game.getRecording(): recording is not enabled — build with { seed, record: true }");
    }
    return this.recorder.toRecording(this.scene.id);
  }

  /**
   * Clear the recording buffer + tick counter while STAYING armed, so a consumer can re-arm at the
   * start of each level (the next tick records as frame 0 in the now-current scene). No-op when
   * recording is disabled.
   */
  resetRecording(): void {
    this.recorder?.reset();
  }

  /**
   * Draw the current world state. No-op headless. `alpha` (default 1) is the render-interpolation
   * factor (`accumulator / fixedDt`, in [0,1)) the rAF loop passes so bodies/camera draw smoothly
   * between ticks; the default 1 draws at the latest sim position (byte-identical, for any direct caller).
   */
  render(alpha = 1): void {
    this.renderer.render(this.world, this.scene.background, alpha);
  }

  /**
   * Match the canvas backing store to its CURRENT CSS display size × `devicePixelRatio`, and scale the
   * 2D context so the renderer keeps drawing in LOGICAL scene coordinates (the scene fills the canvas).
   * Unlike reading `devicePixelRatio` once at construction, this can be re-run — start() calls it on a
   * layout RESIZE (`ResizeObserver`) and a DPR change (browser zoom / a drag to a different-density
   * monitor, via `matchMedia`), and a host may call it directly after relaying out the canvas — so it
   * stays crisp and never over-renders. Render-only (no canvas ⇒ no-op), so determinism is untouched.
   * Before the element is laid out (`getBoundingClientRect` 0, or no DOM) it falls back to the logical
   * scene size — identical to the old fixed sizing — and the first observer callback corrects it.
   */
  resize(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;
    const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const rect = typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : null;
    const cssW = rect && rect.width > 0 ? rect.width : this.scene.size.width;
    const cssH = rect && rect.height > 0 ? rect.height : this.scene.size.height;
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    // Assigning width/height RESETS the transform and CLEARS the canvas — only do it on a real change so
    // a no-op resize callback never flickers; then (re)apply the logical→device transform either way.
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    if (typeof ctx.setTransform === "function") {
      ctx.setTransform(bw / this.scene.size.width, 0, 0, bh / this.scene.size.height, 0, 0);
    }
  }

  /** Start the real-time loop (browser). Throws if no animation clock is available. */
  start(): void {
    if (this.running) return;
    if (typeof requestAnimationFrame !== "function") {
      throw new Error("start() requires requestAnimationFrame; use stepFrames(n) headless");
    }
    this.running = true;

    if (this.attachInput) {
      const keyTarget = typeof window !== "undefined" ? (window as unknown as EventTarget) : null;
      this.world.input.attach({
        keyTarget: keyTarget as never,
        pointerTarget: this.canvas as never,
      });
    }

    // Pause the SIMULATION (not the loop) when the tab is hidden. The browser
    // already throttles/stops rAF while hidden; without this, the first frame on
    // return would replay the whole idle gap (clamped to MAX_FRAME_SECONDS) as a
    // ~15-tick catch-up burst, teleporting the player into an unfair death. We
    // only auto-resume if the player had not already paused by hand.
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      const onVisibility = (): void => {
        if (document.hidden) {
          this.resumeAfterHide = !this.paused;
          this.pause();
        } else if (this.resumeAfterHide) {
          this.resumeAfterHide = false;
          this.resume();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      this.detachLifecycle = () => document.removeEventListener("visibilitychange", onVisibility);
    }

    // Unlock the AudioContext on the first user gesture. Browsers start it SUSPENDED under the autoplay
    // policy, so a scene's `scene.music` started at load stays silent until a gesture resumes it (SFX
    // self-resume on each play(); a loop started at boot has no triggering gesture of its own). resume()
    // is idempotent — a no-op once running or on a player with no context — so firing it per gesture is
    // harmless. Torn down with the rest of the lifecycle in stop().
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      const onGesture = (): void => this.world.audio.resume();
      window.addEventListener("pointerdown", onGesture);
      window.addEventListener("keydown", onGesture);
      const prevDetach = this.detachLifecycle;
      this.detachLifecycle = () => {
        prevDetach?.();
        window.removeEventListener("pointerdown", onGesture);
        window.removeEventListener("keydown", onGesture);
      };
    }

    // Keep the canvas backing store matched to its CSS box × devicePixelRatio as the LAYOUT changes
    // (ResizeObserver) and as the DPR changes (browser zoom / a drag to a different-density monitor —
    // matched via matchMedia, re-armed per DPR since the query is DPR-specific). So devicePixelRatio is
    // no longer read only at construction: the canvas stays crisp and never over-renders. Render-only;
    // torn down with the rest of the lifecycle in stop().
    if (this.canvas) {
      this.resize();
      const teardowns: Array<() => void> = [];
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => this.resize());
        ro.observe(this.canvas);
        teardowns.push(() => ro.disconnect());
      }
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        let mq: MediaQueryList | null = null;
        const onDpr = (): void => {
          this.resize();
          armDpr(); // re-arm: the just-fired query was for the OLD dpr
        };
        const armDpr = (): void => {
          const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
          mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
          mq.addEventListener("change", onDpr, { once: true });
        };
        armDpr();
        teardowns.push(() => mq?.removeEventListener("change", onDpr));
      }
      const prevDetach = this.detachLifecycle;
      this.detachLifecycle = () => {
        prevDetach?.();
        for (const t of teardowns) t();
      };
    }

    this.lastTime = now();
    const loop = (): void => {
      if (!this.running) return;
      // Poll the pause key(s) BEFORE the paused gate, so a fresh press can UNpause a
      // frozen game (the DOM key listeners keep the held set live while paused).
      this.pollPauseKeys();
      if (this.paused) {
        // Keep the clock current so unpausing doesn't replay the paused span.
        this.lastTime = now();
        this.rafId = requestAnimationFrame(loop);
        return;
      }
      const current = now();
      const elapsed = Math.min((current - this.lastTime) / 1000, MAX_FRAME_SECONDS);
      this.lastTime = current;
      this.accumulator += elapsed;
      while (this.accumulator >= this.fixedDt) {
        this.update(this.fixedDt);
        this.accumulator -= this.fixedDt;
      }
      // Render with the leftover-accumulator fraction so bodies/camera draw interpolated between the
      // last two fixed ticks — smooth motion when this rAF frame ran 0, 1, or N sim ticks.
      this.render(this.accumulator / this.fixedDt);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Freeze the simulation WITHOUT detaching input (unlike {@link stop}, which
   * tears down listeners and clears the held-key set — so a key held across a
   * stop()/start() pause goes dead until re-pressed). The rAF loop keeps running
   * so the last frame stays on screen behind any pause overlay; only update() is
   * gated. Idempotent.
   */
  pause(): void {
    this.paused = true;
  }

  /** Resume from {@link pause}, discarding the paused span so there's no catch-up burst. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTime = now();
    this.accumulator = 0;
  }

  /** True while the simulation is frozen by {@link pause} (or a tab-hidden auto-pause). */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Toggle the manual pause — the data-ish pause primitive that replaces each
   * game's bespoke pause state machine. Honors `pauseScenes` (can't PAUSE a disallowed
   * scene, but can always UNpause, so a pause is never stranded by a scene change),
   * flips the sim freeze via {@link pause}/{@link resume}, and emits a `"pause-changed"`
   * event carrying the new `{ paused }` so a host can react (show an overlay, mute audio)
   * WITHOUT owning the pause logic. Safe to call from a DOM button, and it's what the
   * `pauseKeys` loop handler calls. (The toggle itself can't be a behavior/system: those
   * are frozen while paused and so could never unpause — hence keys-in-the-loop + this.)
   */
  togglePause(): void {
    if (!this.paused && this.pauseScenes && !this.pauseScenes.includes(this.scene.id)) return;
    if (this.paused) this.resume();
    else this.pause();
    PAUSE_CHANGED.emit(this.world, { paused: this.paused });
  }

  /**
   * Edge-detect the configured `pauseKeys` from the live held-key set and toggle on a
   * fresh press. Called by the rAF loop BEFORE the paused gate every frame — the DOM
   * key listeners keep the held set current even while the sim is frozen, so this is the
   * one place an unpause can originate. No-op when no pauseKeys are configured.
   */
  private pollPauseKeys(): void {
    if (this.pauseKeys.length === 0) return;
    const down = this.world.input.anyDown(this.pauseKeys);
    if (down && !this.pauseKeyWasDown) this.togglePause();
    this.pauseKeyWasDown = down;
  }

  /** Stop the loop and detach input. */
  stop(): void {
    this.running = false;
    this.paused = false;
    this.resumeAfterHide = false;
    if (this.detachLifecycle) {
      this.detachLifecycle();
      this.detachLifecycle = null;
    }
    if (this.rafId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.world.input.detach();
  }
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
