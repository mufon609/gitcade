import type { BehaviorFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `ride-platform` — a rider standing on a MOVING solid inherits that solid's per-tick world
 * delta (INDIE-ROADMAP two-body CARRY half). Vertical-UP carry already works via push-out (a
 * rising lift pushes the resting body up through `solid-collide`/`tilemap-collide`); this adds
 * HORIZONTAL carry (a platform sliding sideways takes the rider with it) and DESCENDING carry
 * (a sinking platform the rider follows down instead of floating off it).
 *
 * Order it FIRST in the rider's behaviors (before `move-platformer`/`velocity`/`solid-collide`).
 * Each tick, if the rider is NOT rising (`vy >= 0`), it probes for a `carryTag` entity it was
 * RESTING ON last tick — the carrier's top at this tick's start is `carrier.prevY`, so a rider
 * whose bottom sat there (within `stick`px) and whose x-span overlaps is riding it. It then adds
 * the carrier's per-tick world delta to its position: `carrier.x - carrier.prevX` (always) and
 * `carrier.y - carrier.prevY` (only when DESCENDING, > 0 — upward is the push-out's job). Probing
 * the carrier's PRE-tick top (not its current one) means even a fast-descending platform keeps the
 * rider. The rider's own `solid-collide` (later) re-resolves it snug on top, and its walk
 * (`move-platformer` + `velocity`) composes on top — so it can walk while being carried.
 *
 * A CARRIER is any entity tagged `carryTag` that MOVES (a `tween`ed / `velocity`-driven platform);
 * tag it `solid` too so `solid-collide` keeps the rider on it. Author carriers BEFORE riders in the
 * scene so the carrier has already moved this tick when the rider reads its delta (else the carry
 * lags one tick — harmless and self-correcting). Self-contained (own feet-probe + `vy` gate), so it
 * needs no contact state and touches neither `resolveSolids` nor the typed `entity.contacts`.
 *
 * Params:
 *  - `carryTag`: tag marking carrier entities to ride (default `"carrier"`)
 *  - `stick`: feet-probe tolerance in px around the carrier's top (structural; default 2)
 */
export const ridePlatform: BehaviorFn = (entity, world, params) => {
  if (entity.vy < 0) return; // rising / mid-jump — don't get carried
  const carryTag = str(params, "carryTag", "carrier");
  const stick = num(params, "stick", 2);

  const bottom = entity.y + entity.h;
  const left = entity.x;
  const right = entity.x + entity.w;
  for (const c of world.query(carryTag)) {
    if (c === entity) continue;
    // Rested on c's top last tick (c.prevY = c's top at the start of this tick) and overlapping
    // in x. Using the PRE-tick top keeps a fast-descending carrier from leaving the rider behind.
    if (bottom >= c.prevY - stick && bottom <= c.prevY + stick && right > c.x && left < c.x + c.w) {
      entity.x += c.x - c.prevX; // horizontal carry (always)
      const dy = c.y - c.prevY;
      if (dy > 0) entity.y += dy; // descending carry only — upward is handled by the push-out
      return; // ride the first carrier found
    }
  }
};
