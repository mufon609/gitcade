import type { Registry, SystemFn, World } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
// Grid-snap (cell-center) — the one canonical helper, re-exported from the library
// index (a LIBRARY-GAPS #4 generalization), so there's a single source of truth.
import { snapToGrid } from "@gitcade/library";

/**
 * Tower Defense's two custom systems. Both are written param-driven — every
 * balance value arrives via `$cfg` from config.json, none is hardcoded here — so
 * Tower Defense keeps 100% of its balance in config.json. Logged in
 * games/LIBRARY-GAPS.md as generalization candidates ("click-to-place build
 * system" and "event-driven economy/objective counters").
 *
 * `tower-build` is the geometry of placement: it reads the SDK click EDGE, snaps the
 * tap to a grid cell via the library `snapToGrid`, refuses non-buildable (road/lane)
 * tiles via the data tilemap (`world.isBuildable`) and occupied cells, and routes the
 * cost through the library `transaction` system (set a `buyRequest`; audit afford →
 * `world.spend` → emit `tower-bought`; spawn on that event). One audited part owns the
 * money; this system owns the geometry.
 *
 * Both systems register their event listeners via `world.events.onScene` — once per
 * scene ENTRY, guarded by a scene-scoped `world.state` flag — and read live
 * `world.state` on each event. The engine clears scene-scoped listeners on every scene
 * transition, so a "Play again" re-attaches against a clean bus and nothing
 * double-counts.
 */

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Is `(gx,gy)` already occupied by a live tower at that grid cell? */
function cellOccupied(world: World, towerTag: string, gx: number, gy: number, tile: number): boolean {
  return world
    .query(towerTag)
    .some((t) => Math.abs(t.cx - gx) < tile * 0.5 && Math.abs(t.cy - gy) < tile * 0.5);
}

/**
 * `tower-build` — the geometry half of placement. Reads the SDK click EDGE,
 * grid-snaps the tap, validates the TILE is buildable (refuses the road) and the
 * cell is free, then routes the COST through the library `transaction` system by
 * setting `buyRequestKey`; the tower is spawned when `transaction` emits the
 * `boughtEvent` (one audited part owns the money). Seeds the upgrade-affected stats
 * (`rangeKey`/`cooldownKey`/`bountyBonusKey`) from their `$cfg` base on the first
 * tick so the `upgrade-tree` can raise them.
 */
export const towerBuild: SystemFn = (world, params) => {
  const currencyKey = str(params, "currencyKey", "gold");
  const cost = num(params, "towerCost", 0);
  const buyRequestKey = str(params, "buyRequestKey", "buyRequest");
  const boughtEvent = str(params, "boughtEvent", "tower-bought");
  const tile = num(params, "tileSize", 40);
  const rangeKey = str(params, "rangeKey", "towerRange");
  const cooldownKey = str(params, "cooldownKey", "towerCooldown");
  const bountyBonusKey = str(params, "bountyBonusKey", "bountyBonus");
  const towerTag = str(params, "towerTag", "tower");
  const stateKey = str(params, "stateKey", "__towerBuild");

  // Seed upgrade-affected stats once per run (idempotent; survives restart), and attach
  // the bought-event listener the same once-per-scene-entry guard. The seed flag lives in
  // `world.state` (wiped on a scene change), so re-entering `play` re-runs this block.
  const s = (world.state[stateKey] ??= { seeded: false, pending: null }) as {
    seeded: boolean;
    pending: { x: number; y: number } | null;
  };
  if (!s.seeded) {
    s.seeded = true;
    if (typeof world.state[rangeKey] !== "number") world.state[rangeKey] = num(params, "baseRange", 0);
    if (typeof world.state[cooldownKey] !== "number") world.state[cooldownKey] = num(params, "baseCooldown", 0);
    if (typeof world.state[bountyBonusKey] !== "number") world.state[bountyBonusKey] = 0;

    // Spawn the tower when the `transaction` system confirms the purchase. Registered via
    // `onScene`, so it's auto-removed on the next scene change — "Play again" starts from a
    // clean bus. The money side (afford → deduct) lives in `transaction`; on its OK event
    // we place the tower at the snapped cell we stashed when we issued the request.
    world.events.onScene(boughtEvent, (data) => {
      const id = (data as { id?: string } | undefined)?.id;
      if (id !== "tower") return;
      const at = s.pending;
      s.pending = null;
      if (!at) return;
      const def = clone(params.prototype) as Record<string, unknown>;
      const size = (def.size ?? {}) as { w?: number; h?: number };
      const w = size.w ?? tile;
      const h = size.h ?? tile;
      def.position = { x: at.x - w / 2, y: at.y - h / 2 };
      // No spawn-time stamp: the data `stat-modifier` system writes the current
      // upgraded range/cooldown onto this tower the same tick (it runs after this
      // spawn), so the clone's `$cfg` base params are corrected before it fires.
      const tower = world.spawn(def as never);
      world.events.emit("tower-placed", { id: tower.id, x: at.x, y: at.y });
    });
  }

  // Consume this frame's click-release edge.
  for (const tap of world.input.justReleased()) {
    // Grid-snap to the cell center the player clicked.
    const cell = snapToGrid(tap.x, tap.y, tile);

    // Refuse a tower on a road/lane (non-buildable) tile.
    if (!world.isBuildable(cell.x, cell.y)) {
      world.audio.play("lose");
      world.events.emit("build-denied", { reason: "road", x: cell.x, y: cell.y });
      continue;
    }
    if (cellOccupied(world, towerTag, cell.x, cell.y, tile)) {
      world.events.emit("build-denied", { reason: "occupied", x: cell.x, y: cell.y });
      continue;
    }
    // Pre-flight affordability so a denied (too-poor) click still cues, but the
    // authoritative deduct happens in `transaction`.
    if (((world.state[currencyKey] as number) ?? 0) < cost) {
      world.audio.play("lose");
      world.events.emit("build-denied", { reason: "funds", x: cell.x, y: cell.y });
      continue;
    }
    // Stash the target cell and let `transaction` audit + deduct the cost;
    // we spawn on its `boughtEvent`. One click → one buy request.
    s.pending = { x: cell.x, y: cell.y };
    world.state[buyRequestKey] = { id: "tower", cost };
    break; // one build attempt per frame
  }
};

/**
 * `creep-accounting` — the objective economy AND the self-consistent win signal.
 * Attaches its listeners once per scene ENTRY (via `world.events.onScene`) and, on each
 * creep death/leak, awards the bounty (+ the `bountyBonus` upgrade) and ratchets the
 * `resolved`/`leaked` counters that `win-lose-conditions` reads. Also tracks the best
 * wave reached (`bestWaveKey`) for the persisted high-water mark.
 *
 * WIN is DATA, not hand-computed here. This system's only job around the objective is to
 * BRIDGE the `wave-spawner`'s one-shot `waves-complete` EVENT to a latched
 * `world.state[wavesCompleteKey]` flag (events aren't readable by a pure per-tick
 * predicate). The win itself — "all waves complete AND zero live creeps AND not already
 * lost" — lives in the scene's `win-lose-conditions@1.1.0` as a composed condition:
 * `{ all: [ {key:"wavesComplete",truthy}, {tag:"creep",count:"eq"} ] }`. `wave-spawner`
 * emits the event only after the FINAL wave is fully spawned and cleared, and the count
 * condition adds the 0-creeps guard — so no config edit can decouple the win from the
 * wave math.
 */
export const creepAccounting: SystemFn = (world, params) => {
  const currencyKey = str(params, "currencyKey", "gold");
  const bounty = num(params, "bounty", 0);
  const bountyBonusKey = str(params, "bountyBonusKey", "bountyBonus");
  const resolvedKey = str(params, "resolvedKey", "resolved");
  const leakedKey = str(params, "leakedKey", "leaked");
  const killEvent = str(params, "killEvent", "creep-killed");
  const leakEvent = str(params, "leakEvent", "creep-leaked");
  const waveKey = str(params, "waveKey", "wave");
  const wavesCompleteEvent = str(params, "wavesCompleteEvent", "waves-complete");
  // Public (no underscore) so the data `win-lose-conditions` can read it as a flag.
  const wavesCompleteKey = str(params, "wavesCompleteKey", "wavesComplete");
  const bestWaveKey = str(params, "bestWaveKey", "bestWave");
  const stateKey = str(params, "stateKey", "__creepAccounting");

  // Attach the economy/objective listeners once per scene ENTRY: the guard flag lives in
  // `world.state` (wiped on a scene change), and `onScene` auto-removes the listeners on
  // the next transition — so "Play again" re-attaches against a clean bus and never
  // double-counts. The listeners read live `world.state` on each event.
  const s = (world.state[stateKey] ??= { attached: false }) as { attached: boolean };
  if (!s.attached) {
    s.attached = true;
    const bump = (key: string, by: number): void => {
      world.state[key] = ((world.state[key] as number) ?? 0) + by;
    };
    world.events.onScene(killEvent, () => {
      bump(currencyKey, bounty + ((world.state[bountyBonusKey] as number) ?? 0));
      bump(resolvedKey, 1);
    });
    world.events.onScene(leakEvent, () => {
      bump(leakedKey, 1);
      bump(resolvedKey, 1);
    });
    // Latch the one-shot event into a flag the win condition reads. The 0-creeps guard
    // and the win decision itself are the data condition's job.
    world.events.onScene(wavesCompleteEvent, () => {
      world.state[wavesCompleteKey] = true;
    });
  }

  // Track the best wave reached this and across runs (persisted via manifest.persist).
  const wave = (world.state[waveKey] as number) ?? 0;
  const best = (world.state[bestWaveKey] as number) ?? 0;
  if (wave > best) world.state[bestWaveKey] = wave;
};

/**
 * `build-preview` — the placement affordance. Reads the SDK's button-less cursor
 * channel (`world.input.cursor()`) — the desktop hover in world coords — snaps it to a
 * grid cell, and parks a pre-declared range RING + CELL highlight there, recolored GREEN
 * when a turret could go there (buildable tile, cell free, gold ≥ cost) and RED when it
 * could not — so the player sees the reach and the cost-validity BEFORE committing the
 * click. The ring tracks `rangeKey`, so a range upgrade grows the preview too.
 *
 * Presentation only — it owns no game state and never blocks a build (the real placement
 * is still the `tower-build` click edge). Touch has no hover (`cursor()` is null after a
 * tap) and headless has no pointer, so `cursor()` is null there and both preview entities
 * sit off-screen — smoke tests and touch taps are untouched.
 */
export const buildPreview: SystemFn = (world, params) => {
  const tile = num(params, "tileSize", 40);
  const rangeKey = str(params, "rangeKey", "towerRange");
  const currencyKey = str(params, "currencyKey", "gold");
  const cost = num(params, "towerCost", 0);
  const towerTag = str(params, "towerTag", "tower");
  const ring = world.query(str(params, "ringTag", "build-preview"))[0];
  const cell = world.query(str(params, "cellTag", "build-cell"))[0];
  if (!ring && !cell) return;

  // The engine's button-less cursor (world coords), null on touch/headless/off-canvas.
  const hover = world.input.cursor();
  if (!hover) {
    // Not hovering — park both previews off-screen.
    for (const e of [ring, cell]) if (e) { e.x = -9999; e.y = -9999; }
    return;
  }

  const c = snapToGrid(hover.x, hover.y, tile);
  const range = (world.state[rangeKey] as number) ?? 0;
  const ok =
    world.isBuildable(c.x, c.y) &&
    !cellOccupied(world, towerTag, c.x, c.y, tile) &&
    ((world.state[currencyKey] as number) ?? 0) >= cost;
  // Palette greens/reds at low alpha — a hint over the field, never an opaque cover.
  const stroke = ok ? "rgba(167,240,112,0.8)" : "rgba(177,62,83,0.8)";
  const fill = ok ? "rgba(167,240,112,0.13)" : "rgba(177,62,83,0.15)";

  if (ring) {
    const r = Math.max(1, range);
    ring.w = ring.h = r * 2;
    ring.x = c.x - r;
    ring.y = c.y - r;
    (ring.sprite as { stroke?: string }).stroke = stroke;
  }
  if (cell) {
    cell.w = cell.h = tile;
    cell.x = c.x - tile / 2;
    cell.y = c.y - tile / 2;
    (cell.sprite as { color: string; stroke?: string }).color = fill;
    (cell.sprite as { color: string; stroke?: string }).stroke = stroke;
  }
};

export function registerCustomBehaviors(registry: Registry): void {
  registry.registerSystem("tower-build", towerBuild);
  registry.registerSystem("creep-accounting", creepAccounting);
  registry.registerSystem("build-preview", buildPreview);
}
