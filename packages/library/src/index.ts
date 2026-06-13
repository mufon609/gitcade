/**
 * @gitcade/library — the GitCade Component Library (logic half, Phase 2A).
 *
 * Game-agnostic, param-driven BEHAVIORS and SYSTEMS that compose against the
 * FROZEN `@gitcade/sdk`. Nothing here changes the SDK schema: parts are plain
 * {@link BehaviorFn}/{@link SystemFn} implementations registered as new TYPES via
 * the SDK's registration API.
 *
 * Two layers:
 *  - **behaviors/** — per-entity logic: movement, combat, AI, interaction.
 *  - **systems/** — world-wide logic: scoring, lives, timers, spawning,
 *    progression, win/lose, and the economy (inventory, currency, upgrades).
 *
 * Plus {@link registerLibrary}/{@link createLibraryRegistry} (the registration
 * entry points). The machine-readable index ships as `CATALOG.json` at the
 * package root (exported as `@gitcade/library/CATALOG.json`); Phase 6 ingests
 * that file directly.
 *
 * All balance values live in the consuming game's `config.json` and reach a part
 * as `$cfg.<key>` references, resolved by the SDK before the function runs — the
 * SDK validator FAILS any non-structural numeric literal, and every part here is
 * authored to that rule. Phase 2B adds the presentational half (entities, art,
 * audio, UI, FX) and extends the same CATALOG.
 *
 * @packageDocumentation
 */

export * from "./behaviors/index.js";
export * from "./systems/index.js";
export * from "./fx/index.js";
export * from "./ui/index.js";
export * from "./audio/index.js";
export { LIBRARY_PALETTE, PALETTE } from "./palette.js";
export { registerLibrary, createLibraryRegistry } from "./registry.js";
