/**
 * The GitCade schema layer — Zod validators + inferred TypeScript types for every
 * authored artifact: `game.json`, `config.json`, scenes, entities, behaviors, and
 * systems. Every schema here exports BOTH a runtime Zod validator and a static TS
 * type (the type is `z.infer` of the schema), satisfying the requirement
 * that schemas are usable as validators and as types.
 *
 * This module's shapes are FROZEN. Library and game custom parts register new
 * behavior/system *types* at runtime but may not change these shapes.
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
