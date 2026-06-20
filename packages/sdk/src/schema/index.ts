/**
 * The GitCade schema layer — Zod validators + inferred TypeScript types for every
 * authored artifact: `game.json`, `config.json`, scenes, entities, behaviors, and
 * systems. Every schema here exports BOTH a runtime Zod validator and a static TS
 * type (the type is `z.infer` of the schema), satisfying the requirement
 * that schemas are usable as validators and as types.
 *
 * This module's shapes are FROZEN. Library and game custom parts register new
 * behavior/system *types* at runtime but may not change these shapes.
 *
 * STRICTNESS: every fixed-shape object is a `z.strictObject` — an UNKNOWN key is a
 * parse ERROR, not silently stripped (Zod's default), so a typo'd structural field
 * (`layr`, `colour`, `carryable`) fails `gitcade validate` and runtime `createGame`
 * instead of vanishing. Deliberately EXEMPT, because their keys are author- or
 * part-defined (open by design): behavior/system `params`, entity `state`,
 * `config.json`, and tile `properties` (a `.catchall`). Strictness only rejects what
 * stripping would have dropped, so valid artifacts parse byte-identically.
 */
export * from "./common.js";
export * from "./whitelist.js";
export * from "./config.js";
export * from "./sprite.js";
export * from "./params.js";
export * from "./behavior.js";
export * from "./system.js";
export * from "./entity.js";
export * from "./scene.js";
export * from "./scene-inheritance.js";
export * from "./manifest.js";
