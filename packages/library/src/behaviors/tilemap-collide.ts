import type { BehaviorFn, SolidRect } from "@gitcade/sdk";
import { str, resolveSolids, applyContacts } from "@gitcade/sdk";

/**
 * Resolve an entity's AABB against SOLID tilemap cells — the terrain half of
 * platformer collision (INDIE-ROADMAP Tier-0 item 0.2). A cell is solid when its
 * tile-index `properties` carry the `solidProp` flag (default `"solid"`). The entity
 * is pushed out of the cell it ran into, the matching velocity component is zeroed,
 * and the typed contact flags are written to `entity.contacts` for other behaviors to
 * read: `onGround`, `onCeiling`, `onWallL`, `onWallR`.
 *
 * ORDER IT AFTER the velocity integrator (e.g. `move-platformer` → `velocity` →
 * `tilemap-collide`): it corrects the position the integrator just produced, in the
 * SAME tick, so there is no one-frame penetration. `move-platformer` reads the
 * `contacts.onGround` flag this writes (so a tile floor satisfies its jump test) — that read
 * is one tick old, which the part's coyote-time covers. Combines freely with
 * `solid-collide` on the same entity: the contact flags MERGE per tick (so a tile
 * floor and a crate both ground you), regardless of behavior order.
 *
 * ONE-WAY (pass-through) platforms (0.7.0): a cell flagged `oneWayProp` (default
 * `"oneWay"`) is solid only on its TOP face — a falling body lands on it, but a body
 * jumps up THROUGH it and runs past it sideways, and `move-platformer`'s drop-through
 * (down+jump) lets a standing body fall through it. While the mover's drop-through
 * window is open (`entity.dropThrough > 0`) one-way cells are dropped from the solid
 * set entirely, so the body falls; fully solid cells are unaffected by it.
 *
 * The resolution itself is the SDK's shared `resolveSolids` primitive (0.3): this part
 * just gathers the solid CELLS the body could touch this tick into rects and hands them
 * over — `solid-collide` feeds it solid ENTITIES the same way, so a crate is exactly as
 * solid as a tile. `resolveSolids` sub-steps a fast body so it can't tunnel a thin floor
 * between ticks (0.4); at typical speeds it is a single byte-identical pass.
 *
 * Params:
 *  - `solidProp`: tile-property flag marking a fully solid cell (default `"solid"`)
 *  - `oneWayProp`: tile-property flag marking a one-way (top-only) platform cell (default `"oneWay"`)
 */
export const tilemapCollide: BehaviorFn = (entity, world, params, dt) => {
  const t = world.tilemap;
  if (!t) {
    applyContacts(entity, world.frame, {
      onGround: false,
      onCeiling: false,
      onWallL: false,
      onWallR: false,
      onOneWay: false,
    });
    return;
  }
  const solidProp = str(params, "solidProp", "solid");
  const oneWayProp = str(params, "oneWayProp", "oneWay");
  // Drop-through: while the mover's window is open, one-way cells are not solid, so a body
  // standing on a one-way platform falls through it (set by `move-platformer`'s down+jump).
  const dropping = entity.dropThrough > 0;
  const ts = t.tileSize;

  const cellFlag = (col: number, row: number, prop: string): boolean => {
    if (col < 0 || row < 0 || col >= t.cols || row >= t.rows) return false; // OOB: world bounds handle edges
    const idx = t.tiles[row * t.cols + col] ?? -1;
    if (idx < 0) return false;
    return t.properties?.[String(idx)]?.[prop] === true;
  };

  // Broadphase: the solid cells overlapping the body's SWEPT span this tick (its box
  // from before the move to after it), padded one cell so an edge resting flush on a
  // seam still sees the neighbour. A small candidate set keeps the shared resolver's
  // per-rect scan cheap and lets it sub-step fast bodies without scanning the whole grid.
  const x0 = entity.x - entity.vx * dt;
  const y0 = entity.y - entity.vy * dt;
  const c0 = Math.max(0, Math.floor(Math.min(x0, entity.x) / ts) - 1);
  const c1 = Math.min(t.cols - 1, Math.floor((Math.max(x0, entity.x) + entity.w) / ts) + 1);
  const r0 = Math.max(0, Math.floor(Math.min(y0, entity.y) / ts) - 1);
  const r1 = Math.min(t.rows - 1, Math.floor((Math.max(y0, entity.y) + entity.h) / ts) + 1);
  const rects: SolidRect[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (cellFlag(c, r, solidProp)) rects.push({ x: c * ts, y: r * ts, w: ts, h: ts });
      else if (!dropping && cellFlag(c, r, oneWayProp))
        rects.push({ x: c * ts, y: r * ts, w: ts, h: ts, oneWay: true });
    }
  }

  const contacts = resolveSolids(entity, rects, dt);
  applyContacts(entity, world.frame, contacts);
};
