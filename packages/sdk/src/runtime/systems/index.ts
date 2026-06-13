import type { Registry } from "../registry.js";
import { aabbCollision } from "./aabb-collision.js";
import { winCondition } from "./win-condition.js";

/**
 * The built-in system types. `aabb-collision` is registered first so, when a
 * scene lists it first, collisions are detected before entity behaviors run.
 * Phase 2A adds score/lives/timer/spawner systems as additional types.
 */
export const BUILTIN_SYSTEM_TYPES = ["aabb-collision", "win-condition"] as const;

export function registerBuiltinSystems(registry: Registry): void {
  registry.registerSystem("aabb-collision", aabbCollision);
  registry.registerSystem("win-condition", winCondition);
}

export { aabbCollision, winCondition };
