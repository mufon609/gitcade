import type { BehaviorFn } from "@gitcade/sdk";
import { str } from "@gitcade/sdk";
import { PORTAL } from "../channels.js";
import { vec2 } from "../util.js";

/**
 * Teleport entities tagged `tag` to a destination on a fresh CONTACT EDGE — the tick they go from
 * not-overlapping to overlapping the portal. The destination is a fixed `to` point, or — if
 * `targetId` is given — the live position of another entity (e.g. a paired exit portal).
 *
 * Edge-triggered and TIMER-FREE: an entrant fires ONCE on arrival and not again while it keeps
 * overlapping; it must move OFF and back ON to teleport again. An entrant PLACED onto a portal by a
 * teleport (the paired exit) never re-fires it — the source marks the destination so that arrival is
 * suppressed — so a player LINGERING on the exit is never bounced back. Doors, warps, wrap tunnels,
 * level exits.
 *
 * Two per-portal records live in `entity.state` (serialized into the snapshot, so replays/ghosts
 * stay in lockstep across engines):
 *  - `__portalInside`: entrant ids currently OCCUPYING this portal — already fired, suppressed until
 *    they leave (cleared the tick they stop overlapping, so a genuine return re-fires).
 *  - `__portalArrived`: entrant ids teleported ONTO this portal, pending — the next time this portal
 *    sees each, it is consumed AS an arrival (marked inside, NOT fired). The source portal sets this
 *    on the DESTINATION's state, read at the top of the destination's own next tick, so suppression
 *    is independent of which portal runs first in the behavior pass.
 *
 * Params:
 *  - `tag`: tag of entities that can use the portal (default `"player"`)
 *  - `to`: `{ x, y }` destination (structural; used when `targetId` is unset)
 *  - `targetId`: id of an entity whose position is the destination (optional)
 *  - `sound`: sound key on teleport (default `"collect"`)
 */
export const portal: BehaviorFn = (entity, world, params) => {
  const tag = str(params, "tag", "player");
  const targetId = str(params, "targetId", "");
  const sound = str(params, "sound", "collect");
  const to = vec2(params, "to", { x: 0, y: 0 });

  const inside = (entity.state.__portalInside ??= {}) as Record<string, boolean>;
  const arrived = (entity.state.__portalArrived ??= {}) as Record<string, boolean>;
  const present = new Set<string>();

  for (const other of entity.collisions) {
    if (!other.alive || !other.hasTag(tag)) continue;
    present.add(other.id);

    // Teleported ONTO this portal → consume the pending arrival: mark it occupying and DON'T fire,
    // so the entrant is not bounced straight back through the pair.
    if (arrived[other.id]) {
      delete arrived[other.id];
      inside[other.id] = true;
      continue;
    }
    // Still overlapping from a prior tick → already teleported; wait for it to leave.
    if (inside[other.id]) continue;

    // A fresh not-overlapping → overlapping edge → teleport.
    let dest = to;
    const dst = targetId ? world.byId(targetId) : undefined;
    if (dst) dest = { x: dst.cx, y: dst.cy };
    other.x = dest.x - other.w / 2;
    other.y = dest.y - other.h / 2;
    inside[other.id] = true;
    // Suppress the arrival on the destination portal: it will see this entrant next tick and must
    // NOT treat that as a fresh edge. Recorded on the DESTINATION's state (read at the top of its own
    // next tick), so it holds regardless of the two portals' order in this tick's behavior pass.
    if (dst) {
      const dstArrived = (dst.state.__portalArrived ??= {}) as Record<string, boolean>;
      dstArrived[other.id] = true;
    }
    world.audio.play(sound);
    PORTAL.emit(world, { from: entity.id, id: other.id });
  }

  // An entrant that LEFT clears its occupying mark, so returning to the portal re-fires.
  for (const id of Object.keys(inside)) {
    if (!present.has(id)) delete inside[id];
  }
};
