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

/**
 * Public grid-placement helpers (0.2.1, gap #4). These already existed internally
 * in `util.ts` and back the `place-on-free-cell` system + `wave-spawner`
 * `placement:"free-cell"`, but were not re-exported from the package index — so a
 * game wanting grid-snap had to inline the 3-line formula (Tower Defense did). The
 * rest of `util.ts` (vector math, `spawnFrom`, `systemState`) stays internal; only
 * the placement surface is promoted to the public API.
 */
export { snapToGrid, randomFreeCell, type Vec2, type CellBounds, type RandomFreeCellOpts } from "./util.js";

/**
 * Public HUD/economy helpers (0.3.2). `formatCompact` turns a big balance into
 * `1.23K`/`4.5M` for a text-sprite `bind` (the renderer draws raw values, so idle
 * HUDs need this); `cappedOfflineGain` is the capped offline-accrual formula every
 * incremental game re-derived as host boilerplate (LIBRARY-GAPS #6). Both are pure.
 */
export { formatCompact, cappedOfflineGain } from "./util.js";
