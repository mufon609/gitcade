import type { Config } from "../schema/config.js";
import type { Scene } from "../schema/scene.js";
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
 *   4. prune destroyed entities; advance time/frame
 * Rendering (interpolation-free) happens once per animation frame, after updates.
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
  private rafId: number | null = null;
  /** Unsubscribers for the active scene's `flow.on` event edges, torn down on scene change (G1). */
  private flowUnsubs: Array<() => void> = [];

  constructor(opts: GameOptions) {
    if (opts.scenes.length === 0) throw new Error("Game requires at least one scene");
    this.scenes = new Map(opts.scenes.map((s) => [s.id, s]));
    const entry = opts.entrySceneId
      ? this.scenes.get(opts.entrySceneId)
      : opts.scenes[0];
    if (!entry) throw new Error(`entry scene "${opts.entrySceneId}" not found`);
    this.scene = entry;

    this.registry = opts.registry ?? createDefaultRegistry();
    this.fixedDt = opts.fixedDt ?? DEFAULT_FIXED_DT;
    this.canvas = opts.canvas ?? null;
    this.attachInput = opts.attachInput ?? this.canvas != null;

    this.world = new World({
      bounds: { width: this.scene.size.width, height: this.scene.size.height },
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
      this.canvas.width = this.scene.size.width;
      this.canvas.height = this.scene.size.height;
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

    // Reset world contents, then restore the kept slice.
    this.world.entities = [];
    for (const key of Object.keys(this.world.state)) delete this.world.state[key];
    Object.assign(this.world.state, carried);
    // The persistence-restore claim set (0.2.1, G6) is scene-scoped — the active
    // scene owns its persistence/seed systems — so clear it on every transition.
    this.world.resolvePersistKeys(this.world.persistPendingKeys());
    this.world.tilemap = scene.tilemap;
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
    for (const [evt, target] of Object.entries(scene.flow?.on ?? {})) {
      this.flowUnsubs.push(this.world.events.on(evt, () => this.world.requestScene(target)));
    }
  }

  /** Run exactly one fixed-update step. */
  update(dt: number): void {
    this.world.dt = dt;
    this.world.frame += 1;
    this.world.time += dt;

    for (const e of this.world.entities) if (e.collisions.length) e.collisions.length = 0;

    for (const sys of this.systems) sys.fn(this.world, sys.params, dt);

    // Snapshot to keep iteration stable if a behavior spawns/destroys.
    const entities = this.world.entities.slice();
    for (const e of entities) {
      if (!e.alive) continue;
      for (const b of e.behaviors) b.fn(e, this.world, b.params, dt);
    }

    this.world.prune();
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

  /** Draw the current world state. No-op headless. */
  render(): void {
    this.renderer.render(this.world, this.scene.background);
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

    this.lastTime = now();
    const loop = (): void => {
      if (!this.running) return;
      const current = now();
      const elapsed = Math.min((current - this.lastTime) / 1000, MAX_FRAME_SECONDS);
      this.lastTime = current;
      this.accumulator += elapsed;
      while (this.accumulator >= this.fixedDt) {
        this.update(this.fixedDt);
        this.accumulator -= this.fixedDt;
      }
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Stop the loop and detach input. */
  stop(): void {
    this.running = false;
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
