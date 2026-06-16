import type { Registry, SystemFn, World } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
// G4 grid-snap (cell-center). 0.2.1 re-exports `snapToGrid` from the library index
// (LIBRARY-GAPS #4), so the inlined 3-line copy this file used to carry is gone —
// the build now imports the one canonical helper. Same math, one source of truth.
import { snapToGrid } from "@gitcade/library";

/**
 * Tower Defense's two custom systems. Both are written param-driven — every
 * balance value arrives via `$cfg` from config.json, none is hardcoded here — so
 * Tower Defense keeps 100% of its balance in config.json (the governance-flagship
 * requirement). Logged in games/LIBRARY-GAPS.md as generalization candidates
 * ("click-to-place build system" and "event-driven economy/objective counters").
 *
 * 0.2.0 ADOPTION (the heaviest game exercises every new primitive):
 *   • G3 tilemap: the road is now ONE data tilemap (drawn by the renderer, queried
 *     via `world.isBuildable`). `tower-build` REFUSES to place on a non-buildable
 *     (road/lane) tile — the headline "towers on the road" fix. No more rectangle
 *     `path` entities + tower-vs-tower-only occupancy.
 *   • G2 click-to-place: the host `canvas.addEventListener("pointerdown" → state.
 *     placeRequest)` is GONE. `tower-build` reads the SDK click EDGE
 *     (`world.input.justReleased()` + a buildable-tile / occupancy pick) directly.
 *   • G4 grid-snap: the tap is snapped to a cell center via the library `snapToGrid`.
 *   • G5 transaction: placement cost is no longer an inline afford/deduct. The
 *     build first sets a `buyRequest` the library `transaction` system audits
 *     (afford → `world.spend` → emit `tower-bought`); the tower is spawned on that
 *     event. One audited part owns the money; this system owns the geometry.
 *   • G1 flow: title/play/over are data scenes (`flow.on` + `tap-emit`); the host
 *     GameShell is deleted and the game runs the real `game.start()` loop (so the
 *     click edge clears every frame — the Idle Clicker lesson).
 *
 * RESTART SAFETY: `loadScene` clears `world.state` and entities but NOT the event
 * bus, so a listener re-attached on every run would double-fire. Both systems
 * attach their listeners exactly once per World (see `attachOnce`) and read live
 * `world.state` on each event, so a "Play again" never double-counts.
 */

const ATTACHED = new WeakMap<World, Set<string>>();
function attachOnce(world: World, key: string, attach: () => void): void {
  let set = ATTACHED.get(world);
  if (!set) ATTACHED.set(world, (set = new Set()));
  if (set.has(key)) return;
  set.add(key);
  attach();
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Stamp the current upgraded range/cooldown onto a tower definition's turret. */
function stampDef(def: Record<string, unknown>, range: number, cooldown: number): void {
  const behaviors = (def.behaviors ?? []) as Array<{ type: string; params: Record<string, unknown> }>;
  for (const b of behaviors) {
    if (b.type === "ai-aim-and-fire") {
      b.params.range = range;
      b.params.cooldown = cooldown;
    }
  }
}

/** Re-stamp every live tower when an upgrade is bought (so upgrades are global). */
function restampTowers(world: World, towerTag: string, range: number, cooldown: number): void {
  for (const t of world.query(towerTag)) {
    for (const b of t.behaviors) {
      if (b.type === "ai-aim-and-fire") {
        (b.params as Record<string, unknown>).range = range;
        (b.params as Record<string, unknown>).cooldown = cooldown;
      }
    }
  }
}

/** Is `(gx,gy)` already occupied by a live tower at that grid cell? */
function cellOccupied(world: World, towerTag: string, gx: number, gy: number, tile: number): boolean {
  return world
    .query(towerTag)
    .some((t) => Math.abs(t.cx - gx) < tile * 0.5 && Math.abs(t.cy - gy) < tile * 0.5);
}

/**
 * `tower-build` — the geometry half of placement. Reads the SDK click EDGE (G2),
 * grid-snaps the tap (G4), validates the TILE is buildable (G3 — refuses the road)
 * and the cell is free, then routes the COST through the library `transaction`
 * system (G5) by setting `buyRequestKey`; the tower is spawned when `transaction`
 * emits the `boughtEvent` (one audited part owns the money). Seeds the
 * upgrade-affected stats (`rangeKey`/`cooldownKey`/`bountyBonusKey`) from their
 * `$cfg` base on the first tick so the `upgrade-tree` can raise them.
 *
 * Params: `currencyKey`, `towerCost` ($cfg), `buyRequestKey`, `boughtEvent`,
 * `tileSize` (structural), `rangeKey`/`cooldownKey`/`bountyBonusKey`,
 * `baseRange`/`baseCooldown` ($cfg), `minCooldown` ($cfg), `towerTag`,
 * `prototype` (tower entity-def), `stateKey`.
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
  const minCooldown = num(params, "minCooldown", 0.1);
  const towerTag = str(params, "towerTag", "tower");
  const stateKey = str(params, "stateKey", "__towerBuild");

  // Seed upgrade-affected stats once per run (idempotent; survives restart).
  const s = (world.state[stateKey] ??= { seeded: false, pending: null }) as {
    seeded: boolean;
    pending: { x: number; y: number } | null;
  };
  if (!s.seeded) {
    s.seeded = true;
    if (typeof world.state[rangeKey] !== "number") world.state[rangeKey] = num(params, "baseRange", 0);
    if (typeof world.state[cooldownKey] !== "number") world.state[cooldownKey] = num(params, "baseCooldown", 0);
    if (typeof world.state[bountyBonusKey] !== "number") world.state[bountyBonusKey] = 0;
  }

  // Attach once: re-stamp all towers when an upgrade is purchased (global upgrades),
  // AND spawn the tower when the `transaction` system confirms the purchase.
  attachOnce(world, "tower-build-listeners", () => {
    world.events.on("upgrade-purchased", () => {
      const range = (world.state[rangeKey] as number) ?? 0;
      const cd = Math.max(minCooldown, (world.state[cooldownKey] as number) ?? 0);
      restampTowers(world, towerTag, range, cd);
    });
    // The money side (afford → deduct) lives in `transaction`; on its OK event we
    // place the tower at the snapped cell we stashed when we issued the request.
    world.events.on(boughtEvent, (data) => {
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
      stampDef(def, (world.state[rangeKey] as number) ?? 0, Math.max(minCooldown, (world.state[cooldownKey] as number) ?? 0));
      const tower = world.spawn(def as never);
      world.events.emit("tower-placed", { id: tower.id, x: at.x, y: at.y });
    });
  });

  // G2: consume this frame's click-release edge. The host placeRequest path is gone.
  for (const tap of world.input.justReleased()) {
    // G4 grid-snap to the cell center the player clicked.
    const cell = snapToGrid(tap.x, tap.y, tile);

    // G3: the headline fix — refuse a tower on a road/lane (non-buildable) tile.
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
    // Stash the target cell and let `transaction` (G5) audit + deduct the cost;
    // we spawn on its `boughtEvent`. One click → one buy request.
    s.pending = { x: cell.x, y: cell.y };
    world.state[buyRequestKey] = { id: "tower", cost };
    break; // one build attempt per frame
  }
};

/**
 * `creep-accounting` — the objective economy AND the self-consistent win signal.
 * Attaches once per World and, on each creep death/leak, awards the bounty
 * (+ the `bountyBonus` upgrade) and ratchets the `resolved`/`leaked` counters that
 * `win-lose-conditions` reads. Also tracks the best wave reached (`bestWaveKey`)
 * for the persisted high-water mark (G6).
 *
 * TD2 — WIN is derived, never hand-computed. The `wave-spawner` emits
 * `waves-complete` exactly once after the FINAL wave is fully spawned and the field
 * is cleared; we additionally require the LIVE creep count to be 0 and that the
 * player has not already lost. When all three hold we publish the number of waves
 * actually cleared into `clearedKey`; `win-lose-conditions` then wins on
 * `clearedWaves >= $cfg.maxWaves`. Both sides reference the SAME spawner config, so
 * no config edit can decouple the win from the wave math.
 *
 * Params: `currencyKey`, `bounty` ($cfg), `bountyBonusKey`, `resolvedKey`,
 * `leakedKey`, `killEvent`, `leakEvent`, `creepTag`, `waveKey`, `clearedKey`,
 * `wavesCompleteEvent`, `bestWaveKey`, `stateKey`.
 */
export const creepAccounting: SystemFn = (world, params) => {
  const currencyKey = str(params, "currencyKey", "gold");
  const bounty = num(params, "bounty", 0);
  const bountyBonusKey = str(params, "bountyBonusKey", "bountyBonus");
  const resolvedKey = str(params, "resolvedKey", "resolved");
  const leakedKey = str(params, "leakedKey", "leaked");
  const killEvent = str(params, "killEvent", "creep-killed");
  const leakEvent = str(params, "leakEvent", "creep-leaked");
  const creepTag = str(params, "creepTag", "creep");
  const waveKey = str(params, "waveKey", "wave");
  const clearedKey = str(params, "clearedKey", "clearedWaves");
  const wavesCompleteEvent = str(params, "wavesCompleteEvent", "waves-complete");
  const bestWaveKey = str(params, "bestWaveKey", "bestWave");
  const completeFlagKey = "__wavesComplete";

  attachOnce(world, "creep-accounting", () => {
    const bump = (key: string, by: number): void => {
      world.state[key] = ((world.state[key] as number) ?? 0) + by;
    };
    world.events.on(killEvent, () => {
      bump(currencyKey, bounty + ((world.state[bountyBonusKey] as number) ?? 0));
      bump(resolvedKey, 1);
    });
    world.events.on(leakEvent, () => {
      bump(leakedKey, 1);
      bump(resolvedKey, 1);
    });
    world.events.on(wavesCompleteEvent, () => {
      world.state[completeFlagKey] = true;
    });
  });

  // Track the best wave reached this and across runs (persisted via manifest.persist).
  const wave = (world.state[waveKey] as number) ?? 0;
  const best = (world.state[bestWaveKey] as number) ?? 0;
  if (wave > best) world.state[bestWaveKey] = wave;

  // Self-consistent win: all waves spawned AND the field is empty AND not already lost.
  if (
    !world.state.gameOver &&
    world.state[completeFlagKey] === true &&
    world.query(creepTag).length === 0
  ) {
    world.state[clearedKey] = (world.state[waveKey] as number) ?? 0;
  }
};

/**
 * `build-preview` — the placement affordance (0.3.0 sharp-pointer maximize). A host
 * `pointermove` writes the desktop cursor (world coords) to `world.state[hoverKey]`;
 * this system snaps it to a grid cell and parks a pre-declared range RING + CELL
 * highlight there, recolored GREEN when a turret could go there (buildable tile,
 * cell free, gold ≥ cost) and RED when it could not — so the player sees the reach
 * and the cost-validity BEFORE committing the click. The ring tracks `rangeKey`, so
 * a range upgrade grows the preview too.
 *
 * Presentation only — it owns no game state and never blocks a build (the real
 * placement is still the `tower-build` click edge). Touch has no hover and headless
 * has no pointer, so `hoverKey` is unset there and both preview entities sit
 * off-screen — smoke tests and touch taps are untouched.
 *
 * Params: `tileSize` (structural), `rangeKey`, `currencyKey`, `towerCost` ($cfg),
 * `towerTag`, `hoverKey`, `ringTag`, `cellTag`.
 */
export const buildPreview: SystemFn = (world, params) => {
  const tile = num(params, "tileSize", 40);
  const rangeKey = str(params, "rangeKey", "towerRange");
  const currencyKey = str(params, "currencyKey", "gold");
  const cost = num(params, "towerCost", 0);
  const towerTag = str(params, "towerTag", "tower");
  const hoverKey = str(params, "hoverKey", "buildHover");
  const ring = world.query(str(params, "ringTag", "build-preview"))[0];
  const cell = world.query(str(params, "cellTag", "build-cell"))[0];
  if (!ring && !cell) return;

  const hover = world.state[hoverKey] as { x?: unknown; y?: unknown } | undefined;
  if (!hover || typeof hover.x !== "number" || typeof hover.y !== "number") {
    // Not hovering (touch, blur, off-canvas) — park both previews off-screen.
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
