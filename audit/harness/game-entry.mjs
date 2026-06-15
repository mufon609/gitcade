/**
 * Per-game browser entry for the Stage-5a regression harness.
 *
 * Forked from entry.mjs. The only difference: it boots a scene through a registry
 * that has the game's CUSTOM parts registered on top of the full library — exactly
 * the registry the game's own src/main.ts builds (createLibraryRegistry +
 * registerCustomBehaviors). The custom-behaviors module is injected at bundle time
 * via the GAME_CUSTOM define alias (see build-game-bundle.mjs), so one source file
 * serves all six games.
 *
 * window.__GC matches entry.mjs (boot/step/state/entities/reboot/...), so the
 * existing driver in harness.mjs / play-game.mjs reads back the same surface.
 */
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
// Resolved by esbuild's alias to the target game's custom-behaviors/index.ts.
import { registerCustomBehaviors } from "GAME_CUSTOM";

let game = null;
let lastBoot = null;
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
  boot(sources, opts = {}) {
    const canvas = document.getElementById("game");
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    let storage;
    if (opts.persistentStorage) {
      sharedStorage = sharedStorage ?? makePersistentStorage();
      storage = sharedStorage;
    }
    game = createGame(sources, { canvas, registry, attachInput: true, storage });
    lastBoot = { sources, opts };
    game.world.input.attach({ keyTarget: window, pointerTarget: canvas });
    return { ok: true, sceneId: game.scene.id, entities: game.world.entities.length };
  },

  reboot() {
    if (!lastBoot) return { ok: false, err: "no prior boot" };
    return this.boot(lastBoot.sources, lastBoot.opts);
  },

  /** Jump straight to a scene by id (no flow edge needed) — for scene-targeted probes. */
  goScene(id, keep) {
    game.loadScene(id, keep ? { keep } : undefined);
    game.render();
    return { ok: true, sceneId: game.scene.id };
  },

  setState(key, value) {
    game.world.state[key] = value;
    return { ok: true, key };
  },

  emit(event, data) {
    game.world.events.emit(event, data);
    return { ok: true, event };
  },

  entityAt(x, y, tag) {
    const e = game.world.entityAt(x, y, tag);
    return e ? { id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, tags: [...(e.tags ?? [])] } : null;
  },

  isBuildable(x, y) {
    return game.world.isBuildable(x, y);
  },
  tileAt(x, y) {
    return game.world.tileAt(x, y);
  },

  step(n = 1) {
    for (let i = 0; i < n; i++) game.update(game["fixedDt"] ?? 1 / 60);
    game.render();
    return { frame: game.world.frame, time: game.world.time, scene: game.scene.id };
  },

  /**
   * Closed-loop "fly" autopilot for the one-button flyer (Helicopter): each frame,
   * synthesize a Space key-down/up so the chopper hovers near targetY, then step.
   * Reads the player entity's y and presses thrust only when it's below target +
   * sinking — a simple bang-bang controller good enough to keep it alive while we
   * observe obstacles/ramp. Returns the scene id so the driver can stop on game-over.
   */
  fly(frames = 60, targetY = 280, playerTag = "player") {
    const dispatch = (type) =>
      window.dispatchEvent(new KeyboardEvent(type, { code: "Space", bubbles: true }));
    let held = false;
    for (let i = 0; i < frames; i++) {
      const p = game.world.entities.find((e) => e.alive && e.hasTag(playerTag));
      const want = p ? p.y > targetY - 30 : false; // below target → thrust up
      if (want && !held) { dispatch("keydown"); held = true; }
      else if (!want && held) { dispatch("keyup"); held = false; }
      game.update(game["fixedDt"] ?? 1 / 60);
      if (game.scene.id !== "play") break;
    }
    if (held) dispatch("keyup");
    game.render();
    return { scene: game.scene.id, frame: game.world.frame };
  },

  state() {
    return JSON.parse(JSON.stringify(game.world.state));
  },

  scene() {
    return game.scene.id;
  },

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

  pointers() {
    return game.world.input.activePointers();
  },

  /** Move the first entity with `tag` to (x,y) — to set up a deterministic collision. */
  moveEntity(tag, x, y) {
    const e = game.world.query(tag)[0];
    if (!e) return { ok: false };
    e.x = x;
    e.y = y;
    return { ok: true, id: e.id, x: e.x, y: e.y };
  },

  /** Per-entity {id, vx, vy, speed, state} for a tag — for reading e.g. enemy hp. */
  entityStates(tag) {
    return game.world
      .query(tag)
      .map((e) => ({
        id: e.id,
        vx: e.vx,
        vy: e.vy,
        speed: Math.round(Math.hypot(e.vx, e.vy)),
        state: JSON.parse(JSON.stringify(e.state ?? {})),
      }));
  },

  info() {
    return {
      sceneId: game.scene.id,
      bounds: { width: game.world.bounds.width, height: game.world.bounds.height },
      hasTilemap: !!game.scene.tilemap,
      worldHasTilemap: "tilemap" in game.world,
    };
  },
};
