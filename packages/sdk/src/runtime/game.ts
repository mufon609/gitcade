import type { Config } from "../schema/config.js";
import type { Scene } from "../schema/scene.js";
import { isReservedFlowTarget, type ReservedFlowTarget } from "../schema/scene.js";
import { resolveSceneInheritance } from "../schema/scene-inheritance.js";
import type { PersistConfig } from "../schema/manifest.js";
import { World } from "./world.js";
import { Registry } from "./registry.js";
import { Input } from "./input.js";
import { AudioPlayer } from "./audio.js";
import type { StorageAdapter } from "../storage/adapters.js";
import { MemoryStorage } from "../storage/adapters.js";
import { buildEntity } from "./entity-factory.js";
import { resolveParams } from "./params.js";
import { Renderer } from "./renderer.js";
import { createDefaultRegistry } from "./defaults.js";
import type { ResolvedParams, SystemFn } from "./types.js";

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
  /** Fixed timestep in seconds (default 1/60). */
  fixedDt?: number;
  /** Attach DOM input listeners on start (default: true when a canvas is present). */
  attachInput?: boolean;
  /** Cross-run persistence binding (from `manifest.persist`); surfaced on `world.persist` (G6). */
  persist?: PersistConfig;
  /**
   * Ordered level sequence (from `manifest.levels`, E11). Enables the reserved
   * `flow.on` targets `"@next"`/`"@first"` and makes the runtime set
   * `world.state.level` to the active scene's 1-based position in this list.
   */
  levels?: string[];
  /** Scene to route to when `"@next"` advances past the last level (`manifest.levelsComplete`). */
  levelsComplete?: string;
  /**
   * Keys (`KeyboardEvent.code`) that toggle the manual pause (E4). Detected in the
   * rAF loop — which keeps running while paused — so a frozen game can still be
   * UNpaused (a behavior/system can't, since it's frozen). Default: none.
   */
  pauseKeys?: string[];
  /**
   * Scene ids where {@link togglePause} may PAUSE; omit ⇒ any scene. Unpausing is
   * always allowed, so a pause can never be stranded by a scene change (E4).
   */
  pauseScenes?: string[];
}

interface SystemInstance {
  type: string;
  fn: SystemFn;
  params: ResolvedParams;
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
 *   5. resolve dynamic bodies — push every `collider` out of the solid world (1.1.0; no-op when
 *      no entity has a collider, so the frozen 1–4 order is unchanged for every arcade scene)
 *   6. resolve the entity hierarchy — parented entities' world transforms (0.9.0; no-op when
 *      no entity has a parent, so the frozen 1–4 order is unchanged for every pre-0.9 scene)
 * Rendering happens once per animation frame, after the fixed-update catch-up loop, INTERPOLATED
 * between the last two ticks (1.8.0) by the leftover-accumulator fraction so motion stays smooth when
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
  /** Pause-toggle keys + the guard scene set + the loop's edge-detect state (E4). */
  private readonly pauseKeys: string[];
  private readonly pauseScenes: string[] | null;
  private pauseKeyWasDown = false;
  /** Unsubscribers for the active scene's `flow.on` event edges, torn down on scene change (G1). */
  private flowUnsubs: Array<() => void> = [];
  /** Ordered level sequence + completion target (E11); empty list ⇒ no campaign concept. */
  private readonly levels: string[];
  private readonly levelsComplete?: string;

  constructor(opts: GameOptions) {
    if (opts.scenes.length === 0) throw new Error("Game requires at least one scene");
    // Resolve scene inheritance (E11) BEFORE indexing, so the map, the entry scene,
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

    this.world = new World({
      // WORLD bounds = the entry scene's `world` (the scrollable area) or its `size`
      // (viewport) when unset (0.7.0). loadScene re-applies this per scene + sets the
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
      rng: opts.rng,
      persist: opts.persist,
    });

    const ctx = this.canvas ? this.canvas.getContext("2d") : null;
    if (this.canvas) {
      // Render at DEVICE resolution. The canvas is CSS-scaled to fill its stage, so a
      // backing store fixed at the logical scene size is an upsampled low-res bitmap —
      // blurry shapes and text on any HiDPI (retina) display. Size the backing store by
      // devicePixelRatio and scale the context once, so all drawing (which stays in
      // LOGICAL world coordinates, including the renderer's per-frame background fill)
      // maps logical→device px. CSS display size is left to the page (`#game{width:100%}`),
      // so this changes sharpness only — not layout — and the rect-based pointer→world
      // mapping in Input is unaffected. NOTE: assigning canvas.width resets the context
      // transform, so the scale() MUST come after.
      const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      this.canvas.width = Math.round(this.scene.size.width * dpr);
      this.canvas.height = Math.round(this.scene.size.height * dpr);
      if (ctx && typeof ctx.scale === "function") ctx.scale(dpr, dpr);
    }
    this.renderer = new Renderer(ctx);

    this.loadScene(this.scene.id);
  }

  /**
   * Build the world for a scene id (entities + resolved systems).
   *
   * 0.2.0 (G1): preserves an explicit `persist` set across the transition instead
   * of always wiping `world.state`. The preserved keys are the LEAVING scene's
   * `flow.persist` plus any `opts.keepExtra` (the per-hop `requestScene({ keep })`
   * set). With neither — exactly the 0.1.x case, since old scenes have no `flow`
   * and host callers pass no `keepExtra` — the keep set is empty and this is a
   * byte-identical full wipe.
   */
  loadScene(sceneId: string, opts?: { keepExtra?: string[] }): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error(`scene "${sceneId}" not found`);

    // Carry the kept slice of state across the transition (G1). prevPersist comes
    // from the scene we are LEAVING; keepExtra from the requesting part.
    const prevPersist = this.scene?.flow?.persist ?? [];
    const keep = new Set([...prevPersist, ...(opts?.keepExtra ?? [])]);
    const carried: Record<string, unknown> = {};
    for (const k of keep) if (k in this.world.state) carried[k] = this.world.state[k];

    this.scene = scene;

    // Tear down the previous scene's flow edges before installing this scene's, so
    // re-entering a scene never accumulates duplicate listeners on the shared bus.
    for (const off of this.flowUnsubs) off();
    this.flowUnsubs = [];
    // Drop every SCENE-SCOPED event listener (world.events.onScene, E10) the same way —
    // the engine generalization of the per-part "attach once" WeakMap dedup, so an
    // event-driven system re-attaching on "Play again" can't double-fire. Game-lifetime
    // `on` listeners (the flow edges torn down just above, host glue) are untouched.
    this.world.events.clearSceneListeners();

    // Reset world contents, then restore the kept slice.
    this.world.entities = [];
    for (const key of Object.keys(this.world.state)) delete this.world.state[key];
    Object.assign(this.world.state, carried);
    // Unify the difficulty counter with the stage index (E11): when the entered
    // scene is part of the manifest's `levels` sequence, `world.state.level` is its
    // 1-based position. So advancing a stage bumps the same `level` that
    // `scale-by-state`/`level-progression` read — a per-stage difficulty ramp comes
    // for free, with no per-scene config. Games without `levels` never see this key.
    const levelIdx = this.levels.indexOf(scene.id);
    if (levelIdx >= 0) this.world.state.level = levelIdx + 1;
    // The persistence-restore tracking (0.2.1 claim set + 0.3.1 restored set/waiters)
    // is scene-scoped — the active scene owns its persistence/seed systems — so reset
    // it on every transition. Using the dedicated reset (not resolvePersistKeys) means
    // a scene change does NOT emit a spurious "persist-restored" for leftover claims.
    this.world.resetPersistTracking();
    // Logical-action bindings/overrides are scene-scoped too (E1): the active scene
    // owns its `input-actions` system, which re-installs them on its first tick.
    this.world.input.resetActions();
    this.world.tilemap = scene.tilemap;
    // Decouple WORLD bounds from the VIEWPORT (0.7.0). `scene.size` is the viewport
    // the canvas shows; `scene.world` (optional) is the larger simulation area a
    // camera pans across. Behaviors clamp/floor against `world.bounds`; the camera
    // viewport size is the canvas size; pointer→world mapping stays in viewport space.
    // Reset the camera to the origin on every scene load (a new level starts top-left;
    // a `camera-follow` system repositions it on tick 1). With no `scene.world` this is
    // byte-identical to pre-0.7 (bounds == viewport, camera at {0,0}). NOTE: the canvas
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
      };
    });

    // Install the data-driven flow edges: emitting `evt` queues a transition to
    // `target` (drained between ticks, like any requestScene). No host JS needed.
    // A reserved token (`@next`/`@first`, E11) is resolved against `levels` at emit
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
   * Resolve a reserved level-sequence flow target (E11) against `manifest.levels`,
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
    this.world.events.emit("levels-complete", { levels: this.levels.length });
    return null;
  }

  /**
   * Advance to the next level in the manifest sequence (E11) — the programmatic
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
    this.world.dt = dt;
    this.world.frame += 1;
    this.world.time += dt;

    // Snapshot the camera's pre-tick position (1.8.0 render interpolation) BEFORE systems run — a
    // `camera-follow` system moves it this tick, so this captures its start so the renderer can lerp the
    // scroll base between ticks. Render-only; the simulation never reads it (headless stays byte-identical).
    this.world.camera.prevX = this.world.camera.x;
    this.world.camera.prevY = this.world.camera.y;

    // Snapshot each entity's pre-tick position and clear its collision list in one pass.
    // `body.prevX`/`body.prevY` let a carry behavior read a moving solid's per-tick world delta
    // (`x - body.prevX`) later this tick, AND are the source the renderer interpolates between (1.8.0);
    // clearing collisions readies the list for this tick's detection. (Done together to avoid a second
    // full sweep of the entity array.)
    for (const e of this.world.entities) {
      e.body.prevX = e.x;
      e.body.prevY = e.y;
      if (e.collisions.length) e.collisions.length = 0;
    }

    for (const sys of this.systems) sys.fn(this.world, sys.params, dt);

    // Snapshot to keep iteration stable if a behavior spawns/destroys.
    const entities = this.world.entities.slice();
    for (const e of entities) {
      if (!e.alive) continue;
      for (const b of e.behaviors) b.fn(e, this.world, b.params, dt, b.scratch);
    }

    this.world.prune();
    // Resolve every dynamic body against the solid world (1.1.0 unified collision phase): push
    // dynamic colliders out of solid tiles + solid entities, in one owned pass. Appended after
    // prune, BEFORE resolveHierarchy (so a parented child follows a RESOLVED parent) — it does NOT
    // reorder the frozen 1–4 in-tick sequence, and no-ops entirely when no entity has a collider,
    // so an arcade scene is byte-identical.
    this.world.resolveBodies();
    // Resolve the entity hierarchy (0.9.0 scene graph): derive each parented entity's WORLD
    // transform from its parent's settled position THIS tick. Appended after prune (operates on
    // live entities) — it does NOT reorder the frozen 1–4 in-tick sequence, and no-ops entirely
    // when no entity has a parent, so a parentless scene renders byte-identically.
    this.world.resolveHierarchy();
    this.world.events.clear();
    // Clear the one-frame pointer edge buffers (G2) — an edge lives exactly one tick.
    this.world.input.endFrame();

    // Drain a queued scene change AFTER the tick (G1, OQ-5). Doing it here — not in
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
   * Draw the current world state. No-op headless. `alpha` (default 1) is the render-interpolation
   * factor (`accumulator / fixedDt`, in [0,1)) the rAF loop passes so bodies/camera draw smoothly
   * between ticks; the default 1 draws at the latest sim position (byte-identical, for any direct caller).
   */
  render(alpha = 1): void {
    this.renderer.render(this.world, this.scene.background, alpha);
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

    this.lastTime = now();
    const loop = (): void => {
      if (!this.running) return;
      // Poll the pause key(s) BEFORE the paused gate, so a fresh press can UNpause a
      // frozen game (the DOM key listeners keep the held set live while paused). (E4)
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
      // last two fixed ticks (1.8.0) — smooth motion when this rAF frame ran 0, 1, or N sim ticks.
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
   * Toggle the manual pause (E4) — the data-ish pause primitive that replaces each
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
    this.world.events.emit("pause-changed", { paused: this.paused });
  }

  /**
   * Edge-detect the configured `pauseKeys` from the live held-key set and toggle on a
   * fresh press. Called by the rAF loop BEFORE the paused gate every frame — the DOM
   * key listeners keep the held set current even while the sim is frozen, so this is the
   * one place an unpause can originate (E4). No-op when no pauseKeys are configured.
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
