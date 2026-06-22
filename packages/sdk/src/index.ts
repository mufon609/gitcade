/**
 * @gitcade/sdk — the GitCade engine standard.
 *
 * This is the FROZEN contract every GitCade game, the component library, the
 * build worker, and the marketplace all depend on. It exports three
 * layers:
 *
 *  - **schema/** — Zod validators + inferred TS types for `game.json`,
 *    `config.json`, scenes, entities, behaviors, and systems.
 *  - **runtime/** — the entity-component game loop, built-in behavior/system
 *    primitives, input/audio/renderer, and the registration API for adding new
 *    behavior/system TYPES.
 *  - **storage/** — the postMessage storage bridge protocol + adapters (the only
 *    sanctioned persistence path for ecosystem games).
 *
 * Plus `parseGame`/`createGame` (validate + boot raw JSON).
 *
 * This entry is BROWSER-SAFE: it never imports Node built-ins. The Node-only
 * validator lives behind the `@gitcade/sdk/validate` subpath so it can use
 * `fs`/`child_process` without poisoning the browser bundle.
 *
 * @packageDocumentation
 */

// Schema layer (validators + types)
export * from "./schema/index.js";

// Runtime layer
export * from "./runtime/index.js";

// Storage bridge
export * from "./storage/index.js";

// High-level load/boot
export {
  parseGame,
  createGame,
  type RawGameSources,
  type ParsedGame,
  type CreateGameOptions,
} from "./load.js";

// Programmatic validator types only — the implementation is Node-only and lives
// at `@gitcade/sdk/validate` (it uses fs/child_process). Re-exporting the VALUE
// here would pull Node built-ins into the browser bundle.
export type { ValidationResult, Issue } from "./validate/index.js";
