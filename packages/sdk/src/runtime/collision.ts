import type { Entity } from "./entity.js";

/** An axis-aligned bounding box. */
export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True if two AABBs overlap (touching edges do NOT count as overlap). */
export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** True if two entities' boxes overlap. */
export function entitiesOverlap(a: Entity, b: Entity): boolean {
  return aabbOverlap(a, b);
}

/**
 * The minimum-translation axis of overlap between two entities: `"x"` if the
 * horizontal penetration is smaller, else `"y"`. Used by reflection to decide
 * which velocity component to flip on a paddle/wall hit.
 */
export function overlapAxis(a: Entity, b: Entity): "x" | "y" {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return overlapX < overlapY ? "x" : "y";
}
