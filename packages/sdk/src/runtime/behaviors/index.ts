import type { Registry } from "../registry.js";
import { velocity } from "./velocity.js";
import { keyboardAxis } from "./keyboard-axis.js";
import { clampToWorld } from "./clamp-to-world.js";
import { bounceWorldEdges } from "./bounce-world-edges.js";
import { reflectOnHit } from "./reflect-on-hit.js";
import { followEntityAxis } from "./follow-entity-axis.js";
import { scoreZone } from "./score-zone.js";
import { spriteAnimate } from "./sprite-animate.js";

/**
 * The built-in behavior types. These are the minimal general primitives that
 * prove the entity-component model (and compose Pong with zero custom code). The
 * full library of behaviors arrives in Phase 2A and registers ADDITIONAL types
 * the same way — never new schema shapes.
 */
export const BUILTIN_BEHAVIOR_TYPES = [
  "velocity",
  "keyboard-axis",
  "clamp-to-world",
  "bounce-world-edges",
  "reflect-on-hit",
  "follow-entity-axis",
  "score-zone",
  "sprite-animate",
] as const;

export function registerBuiltinBehaviors(registry: Registry): void {
  registry.registerBehavior("velocity", velocity);
  registry.registerBehavior("keyboard-axis", keyboardAxis);
  registry.registerBehavior("clamp-to-world", clampToWorld);
  registry.registerBehavior("bounce-world-edges", bounceWorldEdges);
  registry.registerBehavior("reflect-on-hit", reflectOnHit);
  registry.registerBehavior("follow-entity-axis", followEntityAxis);
  registry.registerBehavior("score-zone", scoreZone);
  registry.registerBehavior("sprite-animate", spriteAnimate);
}

export {
  velocity,
  keyboardAxis,
  clampToWorld,
  bounceWorldEdges,
  reflectOnHit,
  followEntityAxis,
  scoreZone,
  spriteAnimate,
};
