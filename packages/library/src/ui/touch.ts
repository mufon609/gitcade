import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/** A pointer in world coordinates (matches the SDK Input `Pointer`). */
export interface PointerLike {
  x: number;
  y: number;
  down: boolean;
}
export interface Zone {
  x: number;
  y: number;
  r: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pure helper: the analog d-pad vector for a set of pointers and a circular zone.
 * The first DOWN pointer inside the zone yields a direction from the zone center,
 * normalized, with a small deadzone; otherwise `{x:0,y:0}`. Pure and unit-tested —
 * the behaviors below are thin wrappers that read the live SDK Input.
 */
export function dpadVector(pointers: PointerLike[], zone: Zone, deadzone = 0.25): { x: number; y: number } {
  for (const p of pointers) {
    if (!p.down) continue;
    const dx = p.x - zone.x;
    const dy = p.y - zone.y;
    const dist = Math.hypot(dx, dy);
    if (dist > zone.r * 1.6) continue; // pointer is elsewhere on screen
    if (dist < zone.r * deadzone) return { x: 0, y: 0 };
    const n = Math.max(dist, 0.0001);
    const mag = Math.min(1, dist / zone.r);
    return { x: (dx / n) * mag, y: (dy / n) * mag };
  }
  return { x: 0, y: 0 };
}

/** Pure helper: is any DOWN pointer inside the rect? (a touch button press). */
export function buttonPressed(pointers: PointerLike[], rect: Rect): boolean {
  return pointers.some((p) => p.down && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h);
}

/**
 * `touch-dpad` — per-entity BEHAVIOR turning an on-screen virtual d-pad (a circular
 * zone, usually bottom-left) into velocity, so touch players move without a keyboard.
 * Reads the SDK Input's active pointers; idle (no pointers) headless, so smoke tests
 * are unaffected. Pair with the SDK `velocity` integrator after it, like any mover.
 *
 * Params: `speed` (balance → `$cfg`), `zone: { x, y, radius }` (structural screen geometry).
 */
export const touchDpad: BehaviorFn = (entity, world, params) => {
  const z = (params.zone ?? {}) as { x?: number; y?: number; radius?: number };
  const zone: Zone = { x: z.x ?? 90, y: z.y ?? 510, r: z.radius ?? 60 };
  const v = dpadVector(world.input.activePointers(), zone);
  const speed = num(params, "speed", 0);
  entity.vx = v.x * speed;
  entity.vy = v.y * speed;
};

/**
 * `touch-button` — per-entity BEHAVIOR exposing a rectangular on-screen button. While
 * pressed it sets a `world.state` flag (default `"fire"`) to true — game logic
 * (shoot, jump) reads that flag the same way it reads a key. Edge-detects a `pressEvent`
 * emit on the down-transition.
 *
 * Params: `actionKey`, `rect: { x, y, w, h }` (structural), `pressEvent` (optional).
 */
export const touchButton: BehaviorFn = (entity, world, params) => {
  const r = (params.rect ?? {}) as { x?: number; y?: number; w?: number; h?: number };
  const rect: Rect = { x: r.x ?? 640, y: r.y ?? 480, w: r.w ?? 110, h: r.h ?? 110 };
  const pressed = buttonPressed(world.input.activePointers(), rect);
  const key = str(params, "actionKey", "fire");
  world.state[key] = pressed;
  const wasDown = entity.state.__btnDown === true;
  if (pressed && !wasDown) {
    const ev = str(params, "pressEvent", "");
    if (ev) world.events.emit(ev, { action: key });
  }
  entity.state.__btnDown = pressed;
};

/**
 * `tap-emit` — a per-entity BEHAVIOR that emits a game event when the entity is
 * CLICKED/tapped, turning a button into a pure-data flow edge (G1's keystone
 * companion, OQ-7). It reads the SDK's one-frame click edge (`input.justReleased`,
 * G2) and fires only when the release lands on THIS entity as the topmost pick
 * (`world.entityAt`), so stacked UI never double-fires. Wire the emitted event to a
 * `scene.flow.on` edge and title→play→over becomes data, no host JS:
 * `{ "type": "tap-emit", "params": { "emitOnTap": "start-pressed" } }`.
 *
 * Idle headless (no pointers) so smoke tests are unaffected. Params:
 *  - `emitOnTap`: event name to emit on tap (default `"tapped"`)
 */
export const tapEmit: BehaviorFn = (entity, world, params) => {
  const event = str(params, "emitOnTap", "tapped");
  for (const tap of world.input.justReleased()) {
    if (world.entityAt(tap.x, tap.y) === entity) {
      world.events.emit(event, { id: entity.id, x: tap.x, y: tap.y });
      return; // one emit per entity per frame
    }
  }
};
