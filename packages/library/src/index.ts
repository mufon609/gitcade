/**
 * @gitcade/library — the GitCade Component Library.
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
 * package root (exported as `@gitcade/library/CATALOG.json`); the platform
 * ingests that file directly.
 *
 * All balance values live in the consuming game's `config.json` and reach a part
 * as `$cfg.<key>` references, resolved by the SDK before the function runs — the
 * SDK validator FAILS any non-structural numeric literal, and every part here is
 * authored to that rule. The presentational half (entities, art, audio, UI, FX)
 * lives alongside the logic half and shares the same CATALOG.
 *
 * @packageDocumentation
 */

export * from "./behaviors/index.js";
export * from "./systems/index.js";
export * from "./fx/index.js";
export * from "./ui/index.js";
export * from "./audio/index.js";

/**
 * The replay-intro host helper ({@link ReplayIntro} + {@link attachReplayIntro} + {@link parseRecording})
 * — a skippable "Echo" of the player's last run, played back on the canvas before live play begins.
 * A host-side code export built on the SDK's run-recording primitive (`createReplay`), in the same
 * shape as {@link ScreenEffects}/{@link LibraryAudioPlayer}: a pure controller + thin browser glue,
 * registering no runtime type and adding no CATALOG entry.
 */
export * from "./replay/index.js";
export { LIBRARY_PALETTE, PALETTE } from "./palette.js";
export { registerLibrary, createLibraryRegistry } from "./registry.js";

/**
 * Typed event channels for the library's well-known signals (respawn, damage, shoot, upgrade-denied,
 * …) + the re-exported engine {@link GAME_OVER}. The opt-in {@link defineChannel} facade over the
 * SDK EventBus: one declaration per channel name + payload, so emitters/listeners stop re-typing
 * magic strings. The namespace stays open — a game still emits its own raw strings.
 */
export * from "./channels.js";

/**
 * Public grid-placement helpers. These back the `place-on-free-cell` system +
 * `wave-spawner` `placement:"free-cell"`, and are part of the public API so a game
 * wanting grid-snap need not inline the formula. The rest of `util.ts` (vector math,
 * `spawnFrom`, `systemState`) stays internal; only the placement surface is exported.
 */
export { snapToGrid, randomFreeCell, type Vec2, type CellBounds, type RandomFreeCellOpts } from "./util.js";

/**
 * Public HUD/economy helpers. `formatCompact` turns a big balance into `1.23K`/`4.5M`
 * for a text-sprite `bind` (the renderer draws raw values, so idle HUDs need this);
 * `cappedOfflineGain` is the capped offline-accrual formula incremental games would
 * otherwise re-derive as host boilerplate. Both are pure.
 */
export { formatCompact, cappedOfflineGain } from "./util.js";
