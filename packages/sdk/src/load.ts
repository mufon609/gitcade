import { z } from "zod";
import { GameManifestSchema, type GameManifest } from "./schema/manifest.js";
import { ConfigSchema, type Config } from "./schema/config.js";
import { SceneSchema, type Scene } from "./schema/scene.js";
import { Game, type GameOptions } from "./runtime/game.js";
import { createDefaultRegistry } from "./runtime/defaults.js";
import type { Registry } from "./runtime/registry.js";

/** Raw (unparsed) game sources, as read from disk or fetched in the browser. */
export interface RawGameSources {
  manifest: unknown;
  config: unknown;
  /** All scene JSON blobs (the entry is chosen by `manifest.entryPoint`'s scene id, or the first). */
  scenes: unknown[];
}

/** Validated, parsed game sources. */
export interface ParsedGame {
  manifest: GameManifest;
  config: Config;
  scenes: Scene[];
}

/**
 * Parse + validate raw game JSON into typed, defaulted structures. Throws a
 * `ZodError` with precise paths on any schema violation. This is the single
 * parsing path shared by the scaffold bootstrap, the headless smoke test, and the
 * validator — so "valid" means the same thing everywhere.
 */
export function parseGame(raw: RawGameSources): ParsedGame {
  const manifest = GameManifestSchema.parse(raw.manifest);
  const config = ConfigSchema.parse(raw.config);
  const scenes = z.array(SceneSchema).parse(raw.scenes);
  return { manifest, config, scenes };
}

export interface CreateGameOptions extends Omit<GameOptions, "scenes" | "config"> {
  /** Override the registry (e.g. after registering custom behaviors). */
  registry?: Registry;
}

/**
 * Validate raw sources and construct a ready-to-run {@link Game}. The entry scene
 * is resolved from `manifest.entryPoint` when it names a known scene id, otherwise
 * the first scene is used. Register any `custom-behaviors` onto a cloned default
 * registry and pass it via `opts.registry`.
 */
export function createGame(raw: RawGameSources, opts: CreateGameOptions = {}): Game {
  const { manifest, config, scenes } = parseGame(raw);
  const registry = opts.registry ?? createDefaultRegistry();
  // entryPoint is a path like "src/scenes/main.json"; match its basename (sans
  // extension) to a scene id when possible, else fall back to the first scene.
  const entryId = resolveEntrySceneId(manifest, scenes);
  // Surface the manifest's cross-run persistence binding on the world; an
  // explicit opts.persist still wins (lets a host override without a manifest).
  const persist = opts.persist ?? manifest.persist;
  // Forward the level sequence so the runtime can resolve `@next`/`@first`
  // flow targets and track `world.state.level` by stage. Explicit opts win.
  const levels = opts.levels ?? manifest.levels;
  const levelsComplete = opts.levelsComplete ?? manifest.levelsComplete;
  return new Game({ ...opts, scenes, config, registry, entrySceneId: entryId, persist, levels, levelsComplete });
}

function resolveEntrySceneId(manifest: GameManifest, scenes: Scene[]): string | undefined {
  const base = manifest.entryPoint
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.json$/i, "");
  if (base && scenes.some((s) => s.id === base)) return base;
  return scenes[0]?.id;
}
