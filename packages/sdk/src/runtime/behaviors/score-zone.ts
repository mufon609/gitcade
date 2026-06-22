import type { BehaviorFn } from "../types.js";
import { num } from "../params.js";
import { SCORE } from "../channels.js";

interface Zone {
  edge: "left" | "right" | "top" | "bottom";
  scoreKey: string;
}

/**
 * Scores when the entity fully exits the world through a configured edge, then
 * resets it and re-serves. The Pong scoring primitive; generalizes to any
 * "leaves the field → award a point and respawn" rule. Increments
 * `world.state[scoreKey]` and emits a `"score"` event (consumed by HUD bindings
 * and the `win-condition` system).
 *
 * Params:
 *  - `zones`: array of `{ edge, scoreKey }`
 *  - `resetTo`: `{ x, y }` respawn position (structural literals allowed)
 *  - `serveSpeed`: serve speed in px/sec (balance → `$cfg`)
 *  - `serveSpread`: random perpendicular spread (balance → `$cfg`; default 0)
 */
export const scoreZone: BehaviorFn = (entity, world, params) => {
  const zones = (Array.isArray(params.zones) ? params.zones : []) as Zone[];
  const reset = (params.resetTo as { x?: number; y?: number } | undefined) ?? {};
  const serveSpeed = num(params, "serveSpeed", 0);
  const spread = num(params, "serveSpread", 0);
  const W = world.bounds.width;
  const H = world.bounds.height;

  for (const zone of zones) {
    let crossed = false;
    switch (zone.edge) {
      case "left":
        crossed = entity.x + entity.w < 0;
        break;
      case "right":
        crossed = entity.x > W;
        break;
      case "top":
        crossed = entity.y + entity.h < 0;
        break;
      case "bottom":
        crossed = entity.y > H;
        break;
    }
    if (!crossed) continue;

    world.state[zone.scoreKey] = ((world.state[zone.scoreKey] as number) ?? 0) + 1;
    entity.x = reset.x ?? (W - entity.w) / 2;
    entity.y = reset.y ?? (H - entity.h) / 2;

    // Serve toward the side that just conceded; random perpendicular spread.
    const sign = zone.edge === "left" || zone.edge === "top" ? -1 : 1;
    if (zone.edge === "left" || zone.edge === "right") {
      entity.vx = sign * serveSpeed;
      entity.vy = (world.rng() - 0.5) * spread;
    } else {
      entity.vy = sign * serveSpeed;
      entity.vx = (world.rng() - 0.5) * spread;
    }

    SCORE.emit(world, { scoreKey: zone.scoreKey, edge: zone.edge });
    world.audio.play("score");
    break;
  }
};
