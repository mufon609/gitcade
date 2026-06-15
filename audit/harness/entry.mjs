/**
 * Browser entry for the GitCade engine-audit harness.
 *
 * Bundled by build-bundle.mjs into dist/gitcade-bundle.js and loaded by host.html.
 * It exposes a tiny control surface on `window.__GC` so the puppeteer driver
 * (harness.mjs) can: boot an arbitrary SDK scene with the FULL component library
 * registered (exactly the registry an ecosystem game gets via
 * `createLibraryRegistry`), step the simulation deterministically, and read back
 * `world.state` / entity positions. Driving DOM input (keys, pointer clicks) and
 * canvas-pixel hashing is done from the driver via CDP, not here.
 *
 * This is the SAME boot path templates/game-scaffold/src/main.ts uses
 * (createGame + a library-loaded registry), so what the harness observes is what
 * a real game observes.
 */
import { createGame, createDefaultRegistry } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";

let game = null;
/** Last boot inputs, so reboot() can re-create the game from the same sources. */
let lastBoot = null;
/**
 * A storage adapter that SURVIVES a reboot (Stage-3b hook for the G6 probe). A
 * plain in-memory KV held at module scope so two boots with persistentStorage:true
 * share the same backing store — exactly what a real reload (same gameSlug+branch
 * namespace) gives a game through the bridge.
 */
let sharedStorage = null;
function makePersistentStorage() {
  const m = new Map();
  return {
    async get(k) {
      return m.has(k) ? JSON.parse(m.get(k)) : null;
    },
    async set(k, v) {
      m.set(k, JSON.stringify(v));
    },
    async remove(k) {
      m.delete(k);
    },
    async keys() {
      return [...m.keys()];
    },
    async clear() {
      m.clear();
    },
  };
}

window.__GC = {
  /**
   * Boot a scene. `sources` is { manifest, config, scenes }. By default we use a
   * registry preloaded with the SDK built-ins + the whole library. We DO NOT use
   * the rAF loop — the driver calls step() so timing is deterministic and the
   * canvas-hash time series is reproducible.
   */
  boot(sources, opts = {}) {
    const canvas = document.getElementById("game");
    const registry = opts.libraryOnly === false ? createDefaultRegistry() : createLibraryRegistry();
    // G6: when the scenario asks for persistent storage, reuse a module-level
    // adapter across boots so a reboot() sees what the first run saved.
    let storage;
    if (opts.persistentStorage) {
      sharedStorage = sharedStorage ?? makePersistentStorage();
      storage = sharedStorage;
    }
    game = createGame(sources, { canvas, registry, attachInput: true, storage });
    lastBoot = { sources, opts };
    // Attach DOM input WITHOUT starting the rAF loop, so the driver can dispatch
    // real keyboard/pointer events and then advance the sim by hand.
    game.world.input.attach({ keyTarget: window, pointerTarget: canvas });
    return { ok: true, sceneId: game.scene.id, entities: game.world.entities.length };
  },

  /** Re-boot the SAME sources (G6 reload simulation); keeps the shared storage adapter. */
  reboot() {
    if (!lastBoot) return { ok: false, err: "no prior boot" };
    return this.boot(lastBoot.sources, lastBoot.opts);
  },

  /** Set a world.state key (drives data-part requests: purchaseRequest, persisted keys). */
  setState(key, value) {
    game.world.state[key] = value;
    return { ok: true, key };
  },

  /** G1: request a data-driven scene change from "outside" (stands in for a part). */
  requestScene(to, keep) {
    game.world.requestScene(to, Array.isArray(keep) ? { keep } : keep);
    return { ok: true, to };
  },

  /** G2: topmost entity pick at a world point (serialized summary, or null). */
  entityAt(x, y, tag) {
    const e = game.world.entityAt(x, y, tag);
    return e ? { id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, tags: [...(e.tags ?? [])] } : null;
  },

  /** G2: the one-frame click edges (down / up) as the engine currently sees them. */
  justPressed() {
    return game.world.input.justPressed();
  },
  justReleased() {
    return game.world.input.justReleased();
  },

  /** G3: tilemap queries reachable from a part. */
  tileAt(x, y) {
    return game.world.tileAt(x, y);
  },
  isBuildable(x, y) {
    return game.world.isBuildable(x, y);
  },

  /** Advance the fixed-timestep simulation by n frames, then render once. */
  step(n = 1) {
    for (let i = 0; i < n; i++) game.update(game["fixedDt"] ?? 1 / 60);
    game.render();
    return { frame: game.world.frame, time: game.world.time };
  },

  /** Snapshot world.state (deep-cloned to survive structured serialization). */
  state() {
    return JSON.parse(JSON.stringify(game.world.state));
  },

  /** Snapshot live entities: id, tags, position, size, velocity. */
  entities() {
    return game.world.entities
      .filter((e) => e.alive)
      .map((e) => ({
        id: e.id,
        tags: [...(e.tags ?? [])],
        x: e.x,
        y: e.y,
        w: e.w,
        h: e.h,
        cx: e.cx,
        cy: e.cy,
        vx: e.vx,
        vy: e.vy,
      }));
  },

  /** Active pointers as the engine sees them (world coords). */
  pointers() {
    return game.world.input.activePointers();
  },

  /** Scene bounds + current scene id (for sanity checks). */
  info() {
    return {
      sceneId: game.scene.id,
      bounds: { width: game.world.bounds.width, height: game.world.bounds.height },
      hasTilemap: !!game.scene.tilemap,
      // Is the parsed tilemap reachable from the world a behavior/system sees?
      worldHasTilemap: "tilemap" in game.world,
    };
  },

  /**
   * Enumerate the API surface a data-driven part (behavior/system) can actually
   * reach — i.e. what's on `world` and `world.input`. Used to confirm the absence
   * of scene-switch / entity-pick / economy primitives without reading code.
   */
  apiSurface() {
    const world = game.world;
    const input = world.input;
    const worldProto = Object.getOwnPropertyNames(Object.getPrototypeOf(world));
    const inputProto = Object.getOwnPropertyNames(Object.getPrototypeOf(input));
    return {
      worldMethods: worldProto.filter((k) => k !== "constructor"),
      inputMethods: inputProto.filter((k) => k !== "constructor"),
      // Specific primitives a good game would want, present?
      has: {
        "world.loadScene": typeof world.loadScene === "function",
        "world.entityAt": typeof world.entityAt === "function",
        "world.pick": typeof world.pick === "function",
        "world.tileAt": typeof world.tileAt === "function",
        "world.tilemap": "tilemap" in world,
        "world.spend": typeof world.spend === "function",
        "world.canAfford": typeof world.canAfford === "function",
        "input.clicked": typeof input.clicked === "function",
        "input.justPressed": typeof input.justPressed === "function",
        "input.activePointers": typeof input.activePointers === "function",
      },
    };
  },

  /** Call game.loadScene if it exists & is reachable; report what happens to state. */
  tryLoadScene(id) {
    const before = JSON.parse(JSON.stringify(game.world.state));
    // Reachable from a behavior? Behaviors get (entity, world, ...). Does `world`
    // expose any scene-switch? Probe the world surface.
    const worldKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(game.world));
    const reachableFromWorld = worldKeys.includes("loadScene");
    let err = null;
    try {
      game.loadScene(id);
    } catch (e) {
      err = String(e);
    }
    const after = JSON.parse(JSON.stringify(game.world.state));
    return { reachableFromWorld, worldKeys, before, after, err, sceneId: game.scene.id };
  },
};
