import type { BehaviorFn } from "@gitcade/sdk";
import { str, num } from "@gitcade/sdk";
import { PORTAL } from "../channels.js";
import { vec2 } from "../util.js";

/**
 * Teleport entities tagged `tag` to a destination on contact. The destination is
 * a fixed `to` point, or — if `targetId` is given — the live position of another
 * entity (e.g. a paired exit portal). A per-entrant `cooldown` prevents the
 * arrival from instantly re-triggering a portal it lands on. Doors, warps, wrap
 * tunnels, level exits.
 *
 * Params:
 *  - `tag`: tag of entities that can use the portal (default `"player"`)
 *  - `to`: `{ x, y }` destination (structural; used when `targetId` is unset)
 *  - `targetId`: id of an entity whose position is the destination (optional)
 *  - `cooldown`: seconds before the same entity can teleport again (balance → `$cfg`; default 0.5)
 *  - `sound`: sound key on teleport (default `"collect"`)
 */
export const portal: BehaviorFn = (entity, world, params) => {
  const tag = str(params, "tag", "player");
  const cooldown = num(params, "cooldown", 0.5);
  const targetId = str(params, "targetId", "");
  const sound = str(params, "sound", "collect");
  const to = vec2(params, "to", { x: 0, y: 0 });

  for (const other of entity.collisions) {
    if (!other.alive || !other.hasTag(tag)) continue;
    const cds = (other.state.__portalCd ??= {}) as Record<string, number>;
    if (world.time < (cds[entity.id] ?? -Infinity) + cooldown) continue;

    let dest = to;
    if (targetId) {
      const dst = world.byId(targetId);
      if (dst) dest = { x: dst.cx, y: dst.cy };
    }
    other.x = dest.x - other.w / 2;
    other.y = dest.y - other.h / 2;
    cds[entity.id] = world.time;
    // Block an immediate bounce-back through the paired exit portal it lands on.
    if (targetId) cds[targetId] = world.time;
    world.audio.play(sound);
    PORTAL.emit(world, { from: entity.id, id: other.id });
  }
};
