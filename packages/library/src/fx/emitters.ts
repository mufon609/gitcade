import type { BehaviorFn, SystemFn } from "@gitcade/sdk";
import { num, str, strArray } from "@gitcade/sdk";
import { spawnBurst, eventPos } from "./particle.js";
import { PALETTE } from "../palette.js";

/**
 * `explosion` — an event-driven particle SYSTEM. On its first tick it subscribes to
 * a game event (default `"death"`); every time that event fires it bursts fast,
 * gravity-pulled debris at the event's position. Wire a mortal entity's
 * `health-and-death.deathEvent` to the same name and things explode when they die.
 *
 * The subscription attaches exactly ONCE per scene, guarded by this instance's `scratch`
 * (the host hands back the same object each tick): a scene-scoped {@link onScene} listener
 * that's torn down on transition and re-attached on re-entry — the per-instance replacement
 * for the old module-level attach-once `WeakMap`, which leaked the listener across scenes.
 *
 * Params: `event` (listened event), `count`, `speed`, `ttl`, `size`, `gravity`,
 * `colors` (palette hex array).
 */
export const explosion: SystemFn = (world, params, _dt, scratch = {}) => {
  if (scratch.attached) return;
  scratch.attached = true;
  const event = str(params, "event", "death");
  const colors = strArray(params, "colors");
  world.events.onScene(event, (data) => {
    const p = eventPos(world, data);
    spawnBurst(world, {
      x: p.x,
      y: p.y,
      count: num(params, "count", 14),
      speed: num(params, "speed", 160),
      ttl: num(params, "ttl", 0.45),
      size: num(params, "size", 5),
      gravity: num(params, "gravity", 220),
      colors: colors.length ? colors : [PALETTE.orange, PALETTE.yellow, PALETTE.red, PALETTE.light],
      direction: "radial",
    });
  });
};

/**
 * `sparkle` — a gentler event-driven particle SYSTEM: soft upward twinkles (pickups,
 * power-ups, level-ups). Same wiring model as {@link explosion} (once-per-scene
 * `scratch`-guarded `onScene` subscription), default event `"collect"`.
 */
export const sparkle: SystemFn = (world, params, _dt, scratch = {}) => {
  if (scratch.attached) return;
  scratch.attached = true;
  const event = str(params, "event", "collect");
  const colors = strArray(params, "colors");
  world.events.onScene(event, (data) => {
    const p = eventPos(world, data);
    spawnBurst(world, {
      x: p.x,
      y: p.y,
      count: num(params, "count", 8),
      speed: num(params, "speed", 70),
      ttl: num(params, "ttl", 0.6),
      size: num(params, "size", 3),
      gravity: num(params, "gravity", -30),
      colors: colors.length ? colors : [PALETTE.yellow, PALETTE.light, PALETTE.green],
      direction: "up",
    });
  });
};

/**
 * `trail` — a per-entity BEHAVIOR that drips a fading particle behind a moving
 * entity at a fixed rate (projectiles, comets, dashing players). Time-based, so the
 * trail density is frame-rate independent.
 *
 * Params: `rate` (seconds between drips), `ttl`, `size`, `color`.
 */
export const trail: BehaviorFn = (entity, world, params, dt) => {
  const rate = num(params, "rate", 0.04);
  const t = ((entity.state.__trailT as number) ?? 0) + dt;
  if (t < rate) {
    entity.state.__trailT = t;
    return;
  }
  entity.state.__trailT = 0;
  spawnBurst(world, {
    x: entity.cx,
    y: entity.cy,
    count: 1,
    speed: 8,
    ttl: num(params, "ttl", 0.3),
    size: num(params, "size", 4),
    colors: [str(params, "color", PALETTE.blue)],
    layer: entity.layer - 1,
  });
};

/**
 * `dust` — a per-entity BEHAVIOR that kicks up puffs only while the entity is moving
 * (landings, footsteps, sliding). Below `minSpeed` it emits nothing.
 *
 * Params: `rate`, `minSpeed`, `ttl`, `size`, `color`.
 */
export const dust: BehaviorFn = (entity, world, params, dt) => {
  const speed = Math.abs(entity.vx) + Math.abs(entity.vy);
  if (speed < num(params, "minSpeed", 20)) return;
  const rate = num(params, "rate", 0.12);
  const t = ((entity.state.__dustT as number) ?? 0) + dt;
  if (t < rate) {
    entity.state.__dustT = t;
    return;
  }
  entity.state.__dustT = 0;
  spawnBurst(world, {
    x: entity.cx,
    y: entity.y + entity.h,
    count: 2,
    speed: 30,
    ttl: num(params, "ttl", 0.35),
    size: num(params, "size", 3),
    gravity: -10,
    colors: [str(params, "color", PALETTE.light)],
    direction: "up",
    layer: entity.layer - 1,
  });
};
