# `@gitcade/sdk` + `@gitcade/library` 0.2.0 — Design Spec (Stage 3a)

**Status:** DESIGN ONLY. No code in this session. The owner signs off on this
before Stage 3b implements it.
**Inputs:** `audit/ENGINE-AUDIT.md` (§A matrix, §B defects, §C gaps G1–G6),
`audit/ROADMAP.md` (Stage 2 settled 2026-06-15: all six gaps ship in one
`sdk@0.2.0` + `library@0.2.0` wave; GameShell removal deferred to per-game
Stage 4).
**Verified against current source** (rebuilt-fresh path the harness uses):
`packages/sdk/src/{runtime,schema,storage}`, `packages/library/src/{systems,behaviors,util.ts}`.

---

## 1. Release overview

### 1.1 What 0.2.0 contains

0.2.0 closes all six audited capability gaps in one coherent wave. The release
spans both packages because the gaps are interdependent (G6 rides G1; G4 pairs
with G3; G2/G5 lean on the same `world.state` conventions G1 standardizes):

| Gap | Title | Class | Touches |
|---|---|---|---|
| G1 | Data-driven scene/flow control + state hand-off | **SCHEMA-CHANGE** | `Scene` schema (new `flow`), `World` (new `requestScene`/`flow` API), `Game.loadScene` (preserve `persist`), loop (drain queue between ticks) |
| G2 | Pointer click edge + pick | **SDK-PATCH (runtime-only)** | `Input` (`justPressed`/`justReleased`/`taps`), `World` (`entityAt`/`pick`) |
| G3 | Runtime tilemap query | **SCHEMA-CHANGE** | `TilemapSchema` (per-index `properties`), `World` (store tilemap + `tileAt`/`isBuildable`/`cellRect`) |
| G4 | Spawn placement helpers | **ADDITIVE-LIBRARY** | new library parts (`snap-to-grid`, `random-free-cell`, `place-on-free-cell`) |
| G5 | Economy transaction primitive | **ADDITIVE-LIBRARY** | new library `transaction` system; thin `world.canAfford`/`world.spend` SDK assist (optional, see §2.5 OQ) |
| G6 | Cross-scene / cross-run persistence | **SCHEMA-CHANGE (rides G1)** | `Scene`/manifest `persist`+`save` bindings; new `persistence` system reading the storage bridge |

### 1.2 Why one wave

The audit's headline (§D) is that **all six games hand-roll a `GameShell`** (six
identical 305-line copies) plus 600+ lines of `custom-behaviors/` precisely
because these primitives are missing. Shipping them piecemeal would force games
to repin three times. One `0.2.0` = one repin wave in Stage 4, and the keystone
(G1 flow-as-data) only becomes *useful* when G6 (persist across the transitions
G1 introduces) and G2 (the click that drives a menu) land with it.

### 1.3 Compatibility stance — additive-first, 0.1.x unaffected

Every contract change is an **optional schema field** or a **purely additive API
method**. A 0.1.x `game.json`/scene parses byte-for-byte unchanged on 0.2.0 and
runs with identical behavior. The single behavioral change in `loadScene` (state
preservation) is **gated on an opt-in `persist` set that defaults to empty** —
so a 0.1.x game that calls the host-only `loadScene` still gets today's
full-wipe semantics. Detailed compat matrix in §3.

**Tick order & determinism (frozen, honored):** the fixed-update order
(systems → behaviors → prune → events.clear) and the RNG hook (`world.rng`) are
untouched. The one ordering addition — a **scene-change queue drained by the host
loop between ticks** (§2.1) — is deliberately *outside* the tick so it cannot
perturb the in-tick order games exploit (e.g. snake-guard reading post-step
position; `runtime/game.ts:140-158`).

---

## 2. Per-gap design

> Notation: schema deltas are shown as Zod against the current source. "DELETES"
> lists the host/`custom-behaviors` code a game can drop once it adopts the gap
> (this is the data-over-code dividend the prompt asks for). Each gap names its
> harness acceptance probe (full list in §4).

---

### G1 — Data-driven scene/flow control + state hand-off  `SCHEMA-CHANGE`

**The keystone.** Today `loadScene` is a *host* method on `Game`
(`runtime/game.ts:112`), invisible to any behavior/system (Probe 1:
`worldMethods` has no `loadScene`), and it **wipes all `world.state`**
(`game.ts:119`). So a game can neither (a) request a scene change from data nor
(b) carry score/coins/level across one. Three additive pieces fix it.

#### G1.a — Flow API on `World` (parts can request a change)

```ts
// runtime/world.ts — additive, queued (NOT applied mid-tick)
export interface SceneChangeRequest {
  to: string;                 // target scene id
  keep?: string[];            // world.state keys to carry across (overrides scene.flow.persist for this hop)
}

class World {
  /** Pending scene change, drained by the host loop AFTER the current tick. null = none. */
  private _pendingScene: SceneChangeRequest | null = null;

  /**
   * Request a scene transition from inside a behavior/system. The change is
   * QUEUED and applied by the host loop between ticks (never mid-tick), so the
   * frozen in-tick order is preserved. Last request in a tick wins.
   * @param to   target scene id (must exist)
   * @param opts.keep extra world.state keys to preserve for this hop
   */
  requestScene(to: string, opts?: { keep?: string[] }): void {
    this._pendingScene = { to, keep: opts?.keep };
  }

  /** Host-only: read & clear the pending request. Not part of the part-facing surface. */
  takePendingScene(): SceneChangeRequest | null {
    const r = this._pendingScene; this._pendingScene = null; return r;
  }
}
```

The host loop drains it after `update()` (in both `start()`'s rAF loop and after
each `stepFrames` step, AND in the harness driver which calls `update` directly —
see §4 note):

```ts
// runtime/game.ts — after this.update(dt) in the fixed-step pump:
const req = this.world.takePendingScene();
if (req) this.loadScene(req.to, { keepExtra: req.keep });
```

#### G1.b — Flow contract in the scene set (title→play→over as data)

A flow can be authored two ways; **0.2.0 ships the per-scene form** (decentralized,
each scene owns its outgoing edges) with an optional manifest-level `entry`
override. (Manifest-level whole-graph form is an OQ — see §5 OQ-1.)

```ts
// schema/scene.ts — additive optional block
export const SceneFlowSchema = z.object({
  /** Event → target scene id. When this scene emits the event, the host transitions. */
  on: z.record(z.string(), z.string()).default({}),
  /** world.state keys preserved when LEAVING this scene (the in-session hand-off set). */
  persist: z.array(z.string()).default([]),
}).optional();

export const SceneSchema = z.object({
  // ...all existing fields unchanged...
  flow: SceneFlowSchema,           // <-- additive
});
```

The host installs an event listener per `flow.on` edge when a scene loads:

```ts
// runtime/game.ts loadScene(): after systems are built
for (const [evt, target] of Object.entries(scene.flow?.on ?? {})) {
  this.world.events.on(evt, () => this.world.requestScene(target));
}
```

So `{ "flow": { "on": { "start-pressed": "play", "player-dead": "gameover" } } }`
makes title→play→over a pure-data graph. The events come from existing parts (a
`button`/`tap` UI part emits `start-pressed`; `health-and-death` already emits a
death event) — **no host JS**.

#### G1.c — `loadScene` preserves an explicit `persist` set (no more full wipe)

```ts
// runtime/game.ts loadScene(sceneId, opts?) — REPLACES the blanket wipe at :117-122
loadScene(sceneId: string, opts?: { keepExtra?: string[] }): void {
  const scene = this.scenes.get(sceneId);
  if (!scene) throw new Error(`scene "${sceneId}" not found`);
  const prevPersist = this.scene?.flow?.persist ?? [];     // keys the LEAVING scene declared
  const keep = new Set([...prevPersist, ...(opts?.keepExtra ?? [])]);
  const carried: Record<string, unknown> = {};
  for (const k of keep) if (k in this.world.state) carried[k] = this.world.state[k];

  this.scene = scene;
  this.world.entities = [];
  for (const k of Object.keys(this.world.state)) delete this.world.state[k];
  Object.assign(this.world.state, carried);                // <-- restore the kept slice
  // frame/time/accumulator reset unchanged
  // ...build entities + systems unchanged...
}
```

**Backward compat:** a 0.1.x scene has no `flow`, so `prevPersist` is `[]` and
`keepExtra` is `undefined` → `keep` is empty → identical full-wipe behavior. The
new behavior is strictly opt-in via authored `persist`.

#### Worked example — Snake title → play → game-over as DATA

*Before* (`games/snake/src/host/shell.ts`, 305 lines, six identical copies;
`main.ts:27-56` wires effects/onEnterPlay; scenes live as HTML overlays, not
JSON). The screen state machine, pause loop, and game-over card are all host TS.

*After* — three JSON scenes + flow, zero host screen code:

```jsonc
// title.json
{ "id": "title",
  "entities": [ { "id": "start-btn", "tags": ["ui"],
                  "behaviors": [{ "type": "button", "params": { "emitOnTap": "start-pressed" } }] } ],
  "flow": { "on": { "start-pressed": "play" } } }

// play.json  (the existing snake scene + a death edge + carry the score)
{ "id": "play", "entities": [ /* head w/ snake-guard, etc. — unchanged */ ],
  "systems": [ /* snake-body, score, ... unchanged */ ],
  "flow": { "on": { "snake-dead": "gameover" }, "persist": ["score", "best"] } }

// gameover.json
{ "id": "gameover",
  "entities": [ { "id": "score-label", "sprite": { "kind": "text", "bind": "score" } },
                { "id": "retry", "behaviors": [{ "type": "button", "params": { "emitOnTap": "retry" } }] } ],
  "flow": { "on": { "retry": "play" }, "persist": ["best"] } }
```

`score` survives play→gameover (shown on the card); `best` survives across
play→gameover→play. The `snake-guard` behavior, instead of poking a host flag,
calls `world.requestScene("gameover")` *or* emits `snake-dead` (the edge picks it
up). **No `loadScene` host call, no GameShell screen logic.**

#### DELETES (data-over-code dividend)
- All title/pause/game-over **screen-state machine** logic in
  `games/<g>/src/host/shell.ts` (the 305-line shell — the *flow* portion;
  HUD-mirroring/effect glue is separate and shrinks too). Per-game deletion is
  Stage 4; G1 makes it *possible*, demonstrated above on Snake.
- The host-only `game.loadScene` calls and `onEnterPlay` state-reset hooks
  (`games/snake/src/main.ts:47-49`).

#### Migration impact
Additive: old games parse unchanged and keep full-wipe semantics. A game opts in
by adding `flow` blocks and (optionally) splitting one scene into several. **No
game *must* change** to keep working; games adopt it during Stage 4. Low cost.

#### Acceptance probe
`scenarios/g1-scene-flow.mjs` (new) — see §4.

---

### G2 — Pointer click semantics: edge + pick  `SDK-PATCH (runtime-only)`

Today `Input` exposes only the *held* pointer set and **deletes pointers on
`pointerup`** (`input.ts:97-99`), so a part can never observe "clicked this
frame," and there is no `entityAt`/`pick` (Probe 3). All click detection lives in
host `pointerdown` listeners (TD `main.ts:32-39`, idle-clicker `main.ts:85-90`).
**No schema, no wire-protocol, no exported-type change** → patch-class; bundled
into 0.2.0 for one wave.

#### G2.a — Click edge on `Input`

```ts
// runtime/input.ts — retain one frame of edge state instead of deleting on up
export interface Tap { id: number; x: number; y: number; }

class Input {
  private pressedThisFrame: Tap[] = [];
  private releasedThisFrame: Tap[] = [];

  /** Pointers that went DOWN during the frame just simulated. Cleared each tick by endFrame(). */
  justPressed(): Tap[] { return this.pressedThisFrame; }
  /** Pointers that went UP during the frame just simulated (the click EDGE). */
  justReleased(): Tap[] { return this.releasedThisFrame; }
  /** Convenience: true if any pointer was pressed this frame. */
  clicked(): boolean { return this.pressedThisFrame.length > 0; }

  /** Host-only: clear per-frame edge buffers. Called by Game.update() at tick end. */
  endFrame(): void { this.pressedThisFrame.length = 0; this.releasedThisFrame.length = 0; }
}
```

`onPDown` pushes to `pressedThisFrame` (and still upserts the held pointer);
`onPUp` pushes to `releasedThisFrame` **before** deleting from the held map (the
`:97-99` delete stays — we add the edge record, we don't change the held-set
contract). `Game.update()` calls `input.endFrame()` once per tick (after
behaviors, alongside `events.clear()` at `game.ts:157`) so edges live exactly one
fixed tick — matching how games already exploit one-frame windows.

**Determinism note:** real pointer events arrive between ticks (async). The edge
buffer captures them and exposes them for the *next* tick, then clears — so a
headless `stepFrames` run with injected events (the harness path) sees a
deterministic, reproducible edge. This is the same model the harness's
`{ click, holdFrames }` already drives.

#### G2.b — Pick on `World`

```ts
// runtime/world.ts — uses existing AABB + layer order, no new state
/** Topmost live entity whose AABB contains (x,y); optional tag filter. Highest layer/zIndex wins. */
entityAt(x: number, y: number, tag?: string): Entity | undefined {
  let best: Entity | undefined;
  for (const e of this.entities) {
    if (!e.alive) continue;
    if (tag && !e.hasTag(tag)) continue;
    if (x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) {
      if (!best || e.layer > best.layer || (e.layer === best.layer && e.zIndex >= best.zIndex)) best = e;
    }
  }
  return best;
}
/** Alias spelling used in the audit; returns the same topmost entity. */
pick(x: number, y: number): Entity | undefined { return this.entityAt(x, y); }
```

#### Worked example — Tower Defense click-to-place; Idle Clicker click-to-earn

*Before:* TD `main.ts:32-39` adds a canvas `pointerdown` listener that maps
client→world coords and sets `world.state.placeRequest`; idle-clicker
`main.ts:85-90` increments `world.state.clicks` in a host listener.

*After:* a library `tap-emit`/`click-to-earn` part (G4/G5 companions) reads
`world.input.justReleased()` and `world.entityAt(tap.x, tap.y, "button")` inside
a system — TD's `tower-build` consumes the tap directly instead of a
host-populated flag; idle-clicker increments via a data part. The host
`pointerdown` wiring is deleted.

#### DELETES
- TD host click listener + coord mapping (`tower-defense/src/main.ts:32-39`).
- Idle-clicker host click listener (`idle-clicker/src/main.ts:85-90`).
- Any hand-rolled "which rect did I hit" loops in menus.

#### Migration impact
None for existing games (additive API; they keep their host listeners until
Stage 4 chooses to drop them). Low.

#### Acceptance probe
`scenarios/g2-click-edge-pick.mjs` (new).

---

### G3 — Runtime tilemap query  `SCHEMA-CHANGE`

`TilemapSchema` is parsed (`schema/scene.ts:6-14`) but `World` never stores it
(Probe 4: `worldHasTilemap:false`), and there's no `tileAt`. TD therefore can
only check tower-vs-tower occupancy, never tile type → **towers buildable on the
road** (defect B-3). TD's scene encodes the road as individual rectangle entities
today, not a tilemap.

#### G3.a — Per-index properties on `TilemapSchema`

```ts
// schema/scene.ts — additive optional field on the EXISTING TilemapSchema
export const TilePropsSchema = z.object({
  buildable: z.boolean().optional(),
  walkable: z.boolean().optional(),
  lane: z.boolean().optional(),
}).catchall(z.union([z.boolean(), z.number(), z.string()]));  // open for game-specific flags

export const TilemapSchema = z.object({
  tileSize: z.number().positive(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  tiles: z.array(z.number().int()),
  tileset: z.string().optional(),
  /** Map of tile INDEX (stringified) → property flags. Index -1/absent ⇒ empty ⇒ no props. */
  properties: z.record(z.string(), TilePropsSchema).optional(),   // <-- additive
});
```

Example: `"properties": { "0": { "buildable": true }, "1": { "lane": true, "walkable": true, "buildable": false } }`.

#### G3.b — Store tilemap on `World` + query methods

```ts
// runtime/world.ts — tilemap stored at scene load; queries are pure (no per-tick cost)
readonly tilemap?: ParsedTilemap;   // set by Game.loadScene from scene.tilemap

/** Tile index at world (x,y), or -1 if out of bounds / empty. */
tileAt(x: number, y: number): number {
  const t = this.tilemap; if (!t) return -1;
  const col = Math.floor(x / t.tileSize), row = Math.floor(y / t.tileSize);
  if (col < 0 || row < 0 || col >= t.cols || row >= t.rows) return -1;
  return t.tiles[row * t.cols + col] ?? -1;
}
/** True if the tile at (x,y) is flagged buildable (or no tilemap ⇒ true: undecorated scenes stay permissive). */
isBuildable(x: number, y: number): boolean {
  const t = this.tilemap; if (!t) return true;
  const idx = this.tileAt(x, y); if (idx < 0) return false;
  return t.properties?.[String(idx)]?.buildable ?? true;
}
/** World-space rect of grid cell (col,row): { x, y, w, h }. */
cellRect(col: number, row: number): { x: number; y: number; w: number; h: number } {
  const s = this.tilemap?.tileSize ?? 0;
  return { x: col * s, y: row * s, w: s, h: s };
}
```

`Game.loadScene` assigns `world.tilemap = scene.tilemap` (made a settable
internal; the public field is read-only to parts). **Renderer draws the tilemap
in 0.2.0** (OQ-3 resolved — in scope): `runtime/renderer.ts` paints tiles from
`world.tilemap` + its `tileset`, so a scene's road/lanes are one data tilemap,
drawn and queried (no entity/tilemap double-encoding). Additive: a scene without
a tilemap renders exactly as today.

#### Worked example — Tower Defense: reject towers on the road

*Before:* `tower-defense/custom-behaviors/index.ts:104-113` snaps to a cell and
checks only tower-vs-tower occupancy; it **cannot** consult tile type.

*After:* the scene carries a `tilemap` with the road row flagged
`{ lane: true, buildable: false }`; `tower-build` adds one line:
`if (!world.isBuildable(req.x, req.y)) { emit("build-denied"); return; }`. Towers
on the road become impossible — the only real fix for B-3.

#### DELETES
- Nothing is *deleted* (TD still needs its build flow), but the hand-rolled
  road-as-entities encoding collapses to a data tilemap, and the "can't validate
  tile" gap that *forces the bug* is closed centrally.

#### Migration impact
Additive optional field; old scenes (and TD's current entity-road encoding) parse
unchanged. `isBuildable` defaults permissive when no tilemap/props, so adding the
field never breaks an existing scene. TD opts in during Stage 4 (medium: it must
move its road from entities to a tilemap and add the one guard line). Low–medium.

#### Acceptance probe
`scenarios/g3-tilemap-query.mjs` (extends existing `04-tilemap-query.mjs` with
the `properties` map and asserts `isBuildable`).

---

### G4 — Spawn placement helpers  `ADDITIVE-LIBRARY`

`world.spawn`/`spawnFrom` take a **literal** position only (`util.ts:84-104`,
`:93`), so 13 wave spawns stack on one point (Probe 5). Snake hand-rolls free-cell
food (`snake/custom-behaviors/index.ts:213-273`, ~60 lines, with the comment
"the one mechanic Snake needs that no @gitcade/library part provides").

**No SDK change required** — these are library helpers built on `world.query`,
`world.rng` (determinism preserved), `world.bounds`, and G3's tilemap when
present. Shipped as library functions + a thin behavior/system surface so games
reach them from data.

```ts
// packages/library/src/util.ts (internal helpers) + exposed via a part
/** Snap a world point to the center of its grid cell. */
export function snapToGrid(x: number, y: number, tileSize: number): Vec2;

/**
 * A random free cell (no live entity carrying `occupiedTag`), within `bounds`,
 * on a `tileSize` grid; honors world.tilemap walkable/buildable if present.
 * Uses world.rng for deterministic replay. Returns null if the grid is full.
 */
export function randomFreeCell(world: World, opts: {
  tileSize: number; occupiedTag: string;
  bounds?: { x: number; y: number; w: number; h: number };   // defaults to world bounds
  require?: "walkable" | "buildable";                         // optional tilemap gate
}): Vec2 | null;
```

Exposed to data as a **system** `place-on-free-cell` (params: `prototype`,
`tileSize`, `occupiedTag`, `trigger` event, `bounds?`) that, on its trigger,
spawns the prototype at a `randomFreeCell` via the existing `spawnFrom`. Snake
food becomes: emit `eat` → `place-on-free-cell` drops the next food on a verified
free cell. `wave-spawner` gains an optional `placement: "free-cell" | "grid"`
param routing through the same helper (additive param; default = today's literal).

#### Worked example — Snake food
*Before:* 60 lines of occupancy-set construction + retry + deterministic fallback
in `custom-behaviors`. *After:* one `place-on-free-cell` system in the scene
JSON; the helper builds the occupied set from `world.query("snake-body")` and
picks a free cell with `world.rng`. The "first food on the wall" symptom (B-4) is
gone because the helper excludes out-of-bounds and occupied cells by construction.

#### DELETES
- Snake's `spawnFood` free-cell logic (`snake/custom-behaviors/index.ts:213-273`).
- Any spawner needing scatter/no-overlap stops re-implementing it.

#### Migration impact
New library part → a game bumps `libraryVersion` to use it. No schema change. Old
games unaffected. Low.

#### Acceptance probe
`scenarios/g4-free-cell.mjs` (new) — re-run the Probe-5 setup with
`placement:"free-cell"` and assert distinct, in-bounds, non-overlapping positions.

---

### G5 — Economy transaction primitive  `ADDITIVE-LIBRARY`

`currency` is a passive accumulator (`currency.ts:18-32`); the only buy flow is
`upgrade-tree`'s single request flag (`upgrade-tree.ts:40-84`), useless for
"buy-and-place-a-thing." TD re-implements afford→deduct inline
(`tower-defense/custom-behaviors/index.ts:115-125`).

A generic **`transaction` system** generalizes both. Request-flag driven (same
pattern as `upgrade-tree`, so it composes with existing UI emit conventions):

```ts
// packages/library/src/systems/transaction.ts (NEW)
interface TxnRequest { id: string; cost: number; }
/**
 * Generic afford → deduct → emit. A part/UI sets world.state[requestKey] to a
 * { id, cost } (or an id resolved against a `costs` param map). Each tick this
 * checks world.state[currencyKey] >= cost; if so deducts and emits `onOk`
 * (default "purchased") with the request; else emits `onDenied`
 * ("purchase-denied", reason "insufficient-funds"). Clears the request either way.
 * Params: currencyKey (default "currency"), requestKey (default "purchaseRequest"),
 *         onOk, onDenied, costs? (id→cost map for fixed-price catalogs).
 */
export const transaction: SystemFn = (world, params) => { /* ... */ };
```

**Optional SDK assist (OQ-2):** a thin `world.canAfford(key, cost)` /
`world.spend(key, cost): boolean` on `World` would let *behaviors* (not just the
system) do inline checks cleanly, and the harness `apiSurface` already probes for
them. They're trivial and non-contractual (just typed read/compare/write on
`world.state`). Recommendation: include them — cheap, and they make the
transaction system itself a 5-line wrapper. Flagged as OQ because it's the one
"is this library-only or does it earn an SDK method?" judgment.

#### Worked example — Tower Defense buy-and-place
*Before:* inline `if (gold >= cost) { gold -= cost; spawn }`
(`custom-behaviors/index.ts:97-125`). *After:* `tower-build` emits a purchase
request; `transaction` deducts and emits `purchased`; the placement (G4 grid-snap
+ G3 buildable check) happens on `purchased`. Affordability logic lives in one
audited part.

#### DELETES
- TD inline afford/deduct (`tower-defense/custom-behaviors/index.ts:97-125`, the
  economy half).
- Idle-clicker's bespoke economy can route through `transaction`/`upgrade-tree`
  uniformly.

#### Migration impact
New library part (+ optional additive `world` methods). Opt-in via
`libraryVersion`. Low.

#### Acceptance probe
`scenarios/g5-transaction.mjs` (new) — seed currency, fire affordable + unaffordable
requests, assert deduct + `purchased`/`purchase-denied` events and balance.

---

### G6 — Cross-scene / cross-run persistence  `SCHEMA-CHANGE (rides G1)`

G1's `flow.persist` covers **in-session** cross-scene state. G6 adds **cross-run**
(survives reload) persistence declaratively, so the storage bridge round-trips
named `world.state` keys **without host JS** (today idle-clicker does this by
hand: `main.ts:47-57` load, `:59-72` snapshot/save, `:74-82` autosave —
all host TS over the SDK storage bridge).

**The bridge wire protocol is untouched** (`storage/protocol.ts` is frozen: tag,
nonce, sessionId, get/set/keys). G6 adds a *consumer* of the existing
`world.storage` adapter, not a new message type.

#### G6.a — Declarative save/load binding

```ts
// schema/scene.ts (or manifest — see OQ-1) — additive
export const PersistSchema = z.object({
  /** world.state keys to persist across runs (saved on change/interval, loaded on boot). */
  keys: z.array(z.string()).default([]),
  /** Storage key namespace suffix (the bridge already namespaces by gameSlug+branch). */
  slot: z.string().default("save"),
  /** Autosave cadence in seconds (0 = save only on scene change / explicit emit). */
  everySeconds: z.number().nonnegative().default(0),
}).optional();
```

Placed at the **manifest** level (game-wide save is more natural than per-scene —
this is the leading OQ-1 question) OR per-scene. Either way, a new **library or
SDK `persistence` system** does the work:

```ts
// On scene load: world.storage.get(`${slot}`) → JSON.parse → Object.assign into
//   world.state for each declared key (only if absent, so a live value wins).
// Each tick: if a declared key changed (or everySeconds elapsed, or a "save" event
//   fired), world.storage.set(slot, JSON.stringify(pick(world.state, keys))).
// All async I/O is the storage ADAPTER's job; the system just calls get/set —
//   identical to how idle-clicker's host code uses it, but driven by data.
```

This stays inside the behavior-contract purity rule because storage ops go
*through the world API* (`world.storage`), which is the sanctioned escape hatch
(`types.ts:18` "side effects go through the world API … spawn/destroy/events/audio/storage").

#### Worked example — Idle Clicker prestige/coins survive reload
*Before:* `idle-clicker/src/main.ts:47-90` + `shell.ts:173-199` (offline credit)
— host TS owns load/save/autosave. *After:* manifest
`"persist": { "keys": ["coins","clickPower","autoRate","upgrades","prestigeMult"], "everySeconds": 5 }`
and a `persistence` system in the scene. Snake's "Best" high score persists with
two lines of data (`persist.keys: ["best"]`).

#### DELETES
- Idle-clicker host save/load/autosave (`main.ts:47-82`).
- Snake/any high-score host persistence.

#### Migration impact
Additive; folds into G1's schema work. Old games unaffected (no `persist` ⇒ no
persistence). Offline-credit math (idle-clicker `shell.ts:183-188`) is *not* in
scope — it needs a saved timestamp; flagged OQ-4. Low–medium.

#### Acceptance probe
`scenarios/g6-persist.mjs` (new) — boot with a mock storage adapter, set a
persisted key, reload (re-boot same sources + same adapter), assert the key is
restored; assert a non-persisted key is not.

---

## 3. Schema migration & repin plan

### 3.1 What changes in the contract

| Artifact | Change | Type | 0.1.x impact |
|---|---|---|---|
| `schema/scene.ts` `SceneSchema` | new optional `flow` (`on`, `persist`) | additive field | none — absent ⇒ today's behavior |
| `schema/scene.ts` `TilemapSchema` | new optional `properties` (per-index flags) | additive field | none — absent ⇒ `isBuildable` permissive |
| `schema/manifest.ts` (OR scene) | new optional `persist` (`keys`, `slot`, `everySeconds`) | additive field | none — absent ⇒ no persistence |
| `runtime/world.ts` | `requestScene`, `entityAt`/`pick`, `tileAt`/`isBuildable`/`cellRect`, (opt) `canAfford`/`spend`, read-only `tilemap` | additive API | none |
| `runtime/input.ts` | `justPressed`/`justReleased`/`clicked`/`taps`, `endFrame` | additive API | none |
| `runtime/game.ts` | `loadScene` signature `(id, opts?)`; preserve `persist`; drain scene queue + `endFrame` per tick | **behavioral**, gated on opt-in `persist` | none unless game declares `persist` |
| `@gitcade/library` | new parts: `place-on-free-cell`, `snap-to-grid`/`random-free-cell`, `transaction`, `persistence`; `wave-spawner` gains `placement` param | additive parts/params | none |
| `storage/protocol.ts` | **UNCHANGED** (frozen wire) | — | none |

**No game *must* change** to keep running on 0.2.0. Every game *may* opt in,
gap-by-gap, during its Stage 4 session.

### 3.2 Repin order (Stage 4 — informational, not built here)

Repin follows the audit's simple→complex Stage-4 order so the heaviest consumer
lands last with every primitive available:

1. **Snake** — G1 (flow demo), G4 (food), G6 (best score).
2. **Breakout** — G1 (levels/flow).
3. **Helicopter** — G1; verify wave-spawner placement param.
4. **Survival Arena** — G1, G4 (spawn scatter), G5 if it has economy.
5. **Idle Clicker** — G6 (prestige/coins), G5 (economy dedupe), G1.
6. **Tower Defense** — all of G2 (click-place), G3 (buildable road), G4
   (grid-snap), G5 (buy), G1 (flow). Heaviest; last.

Each game bumps `sdkVersion`→`0.2.0` and (ecosystem tier) `libraryVersion`→`0.2.0`
in its own session, deletes the GameShell flow code it can now express as data,
and re-verifies by replay (not diff).

---

## 4. Acceptance tests

Each gap gets a harness probe that is **FAIL today, PASS after 0.2.0**. New stub
scenarios are added under `audit/harness/scenarios/` (this session may add stubs
marked not-yet-passing; they encode the assertion for Stage 3b). The harness
`entry.mjs` `apiSurface()` already probes for `world.entityAt/pick/tileAt/
spend/canAfford` and `input.clicked/justPressed` — those flip to `true`.

**Harness driver note (load-bearing for G1):** the harness advances the sim by
calling `game.update(dt)` directly (`entry.mjs:39-43`), bypassing `start()`'s
loop. So the scene-change queue **must be drained where every caller hits it** —
recommended: drain inside `Game.update()` at tick end (after `events.clear()`),
or expose a `game.flushSceneChange()` the harness `step()` calls. Stage 3b must
pick one; OQ-5. (If drained only in `start()`, headless tests and the validator
won't see transitions.)

| Gap | Probe | FAIL now → PASS after | Observable assertion |
|---|---|---|---|
| G1 | `g1-scene-flow.mjs` (new) | `world.requestScene` absent; `loadScene` wipes state | After a part calls `requestScene("two",{keep:["gold"]})` and one step, `scene.id==="two"` AND `state.gold` preserved; a `flow.on` event edge also transitions. |
| G2 | `g2-click-edge-pick.mjs` (new) | `input.justPressed`/`world.entityAt` absent | After `{click,holdFrames:1}` then release, `justReleased()` reports the tap for exactly one tick; `entityAt(150,120,"pickable")` returns rect "b". |
| G3 | `g3-tilemap-query.mjs` (new; extends `04`) | `worldHasTilemap:false`, no `tileAt` | `world.tileAt(75,75)===1` (road), `isBuildable(75,75)===false`, `isBuildable(25,25)===true`. |
| G4 | `g4-free-cell.mjs` (new; extends `05`) | spawns stack at one point | With `placement:"free-cell"`, N spawns have N distinct in-bounds cells, none overlapping an occupied tag. |
| G5 | `g5-transaction.mjs` (new) | `world.spend`/transaction absent | Affordable request: balance drops by cost, `purchased` emitted; unaffordable: balance unchanged, `purchase-denied` emitted. |
| G6 | `g6-persist.mjs` (new) | `loadScene` wipes; no declarative save | Set persisted key, re-boot with same adapter ⇒ key restored; non-persisted key absent. |

(The existing `01`/`03`/`04`/`05`/`06` probes remain as the documented FAILing
baseline; the `g*` probes are the PASS targets.)

---

## 5. Open questions — RESOLVED 2026-06-15

> All seven resolved at the Stage 3a review gate. Stage 3b builds to these.

| OQ | Resolution | Decided by |
|---|---|---|
| OQ-1 Flow location | **Per-scene `flow.on`** (+ optional manifest `entry` override) | PM |
| OQ-2 Economy SDK assist | **Add `world.canAfford`/`world.spend`** (thin, non-contractual) | PM |
| OQ-3 Tilemap rendering | **IN SCOPE — renderer draws the tilemap in 0.2.0** (road = one data tilemap, drawn + queried; no double-encoding) | Owner |
| OQ-4 Offline-credit | **OUT of 0.2.0** — generic persistence only; offline earnings stay a shim / later part | Owner |
| OQ-5 Scene-queue drain | **Drain at end of `Game.update()`** (every caller, incl. harness/validator, sees transitions) | PM |
| OQ-6 `persist` location | **Split** — `flow.persist` on scene (in-session), `persist` on manifest (cross-run) | PM |
| OQ-7 `tap-emit` part | **Add a minimal `tap-emit` UI part** (depends on G2) so flow edges are data-driven | PM |

**Scope delta from OQ-3:** G3 now also adds **tilemap rendering** to
`runtime/renderer.ts` — draw tiles from `world.tilemap` using its `tileset` when
present. Additive (a scene with no tilemap renders exactly as today). Tower
Defense migrates its road from rectangle entities to a single data tilemap in
Stage 4 (drawn by the renderer, queried via `isBuildable`).

<details><summary>Original open-question detail (for the record)</summary>

**OQ-1 — Flow graph: per-scene vs manifest-level.** This spec ships the
**per-scene `flow.on`** form (each scene owns its outgoing edges) plus a manifest
`entry` override. A whole-graph manifest block (`{ entry, transitions: [...] }`)
centralizes the state machine but duplicates scene ids. *Recommendation:*
per-scene (decentralized, local reasoning, matches how events are already
emitted). **Confirm, or request the manifest-graph form.**

**OQ-2 — Does G5 earn SDK `world.canAfford`/`world.spend`, or stay
library-only?** The transaction *system* needs no SDK change, but two trivial
`world` methods would let behaviors do inline checks and satisfy the existing
`apiSurface` probe. *Recommendation:* add them (cheap, non-contractual). **Approve
adding the two methods, or keep economy strictly library-side?**

**OQ-3 — Should the renderer draw the G3 tilemap in 0.2.0, or stay query-only?**
This spec scopes G3 to *query* (no rendering); TD currently draws its road as
entities. Rendering tiles is additive but more work. *Recommendation:* query-only
in 0.2.0; renderer support later. **Confirm query-only.**

**OQ-4 — Offline-progress / elapsed-time credit (idle-clicker) — in or out of
G6?** G6 persists named keys; computing offline earnings needs a saved wall-clock
timestamp and a credit formula (idle-clicker `shell.ts:183-188`). That's a
game-specific mechanic, not a generic primitive. *Recommendation:* out of 0.2.0;
idle-clicker keeps a tiny host shim or a dedicated `offline-credit` library part
in a later release. **Confirm offline-credit is out of scope.**

**OQ-5 — Where is the scene-change queue drained for headless callers?** The
harness/validator drive `update()` directly, not `start()`. Draining must happen
where all callers hit it (inside `update()` tick-end, or a `flushSceneChange()`
the stepper calls). *Recommendation:* drain at the end of `Game.update()` (one
place, every caller covered). **Confirm, or prefer an explicit flush the loop
calls?** (Minor risk: draining inside `update` means a transition takes effect on
the *next* `update`, not synchronously — acceptable and deterministic.)

**OQ-6 — `persist` location: manifest vs scene (couples with OQ-1).** Cross-*run*
save is game-wide, so manifest feels right; but per-scene `persist` keys (G1) are
already on the scene. Mixing the in-session set (scene `flow.persist`) and the
cross-run set (manifest `persist`) is the cleanest split. *Recommendation:*
`flow.persist` on scene (in-session), `persist` on manifest (cross-run).
**Confirm the split, or unify under one block?**

**OQ-7 — `button`/`tap` UI part for flow edges.** G1's title→play demo assumes a
data part that emits an event on tap (e.g. `start-pressed`). The UI layer
(`packages/library/src/ui`) has touch helpers; whether a generic
`button`/`tap-emit` part already covers this or needs adding in 0.2.0 should be
confirmed. *Recommendation:* add a minimal `tap-emit` part (depends on G2) so the
flow demo is fully data-driven. **Approve adding `tap-emit` to the 0.2.0 library
wave.**

</details>

---

## 6. Implementation plan for Stage 3b (plan only — do not build here)

Ordered so each step unblocks the next; SDK before library; schema before runtime
that reads it. Re-verify each step against its §4 probe.

1. **G2 (runtime-only, no deps) first — cheapest win.**
   - `Input`: add edge buffers + `justPressed/justReleased/clicked/endFrame`;
     `onPDown`/`onPUp` record edges; keep the held-set delete.
   - `Game.update`: call `input.endFrame()` at tick end (next to `events.clear()`).
   - `World`: add `entityAt`/`pick`.
   - ✅ `g2-click-edge-pick.mjs` PASS. *Risk:* edge timing vs async events — covered
     by the one-tick-then-clear rule; verify in headless + headed harness.

2. **G3 schema + runtime + renderer.**
   - `TilemapSchema.properties` (additive); `ParsedTilemap` type.
   - `World.tilemap` (read-only) set in `loadScene`; `tileAt/isBuildable/cellRect`.
   - **Renderer (OQ-3 in scope):** `runtime/renderer.ts` draws tiles from
     `world.tilemap` + `tileset`; no-op when absent (0.1.x scenes unchanged).
   - ✅ `g3-tilemap-query.mjs` (query) + a render assertion (tilemap pixels drawn).
     *Risk:* low — pure read for query; renderer draw is additive and guarded on
     tilemap presence.

3. **G1 schema + flow runtime (keystone) — depends on the loop drain decision (OQ-5).**
   - `SceneFlowSchema` (additive `flow`).
   - `World.requestScene`/`takePendingScene`.
   - `Game.loadScene(id, opts?)` preserve-persist refactor; install `flow.on`
     listeners; drain the queue at `update()` tick-end.
   - ✅ `g1-scene-flow.mjs`. *Risk (highest):* preserving determinism — drain
     OUTSIDE the tick, never mid-tick; ensure old full-wipe path is byte-identical
     when `persist` empty (regression-test a 0.1.x scene). The harness driver
     must see transitions (OQ-5).

4. **G6 schema + persistence system (rides G1).**
   - `PersistSchema` (manifest, per OQ-6); `persistence` system using
     `world.storage` get/set; load-on-scene-load, save-on-change/interval/event.
   - ✅ `g6-persist.mjs`. *Risk:* async storage vs deterministic stepping — the
     system fires get/set but does not *await* inside the tick; restore is
     idempotent and "live value wins." Use a synchronous `MemoryStorage` in tests.

5. **G4 library parts (depends on G3 for tilemap-gated cells; G2 not required).**
   - `snapToGrid`/`randomFreeCell` in `util.ts`; `place-on-free-cell` system;
     `wave-spawner` `placement` param.
   - ✅ `g4-free-cell.mjs`. *Risk:* determinism — use `world.rng`, not `Math.random`.

6. **G5 library part (+ optional SDK assist per OQ-2).**
   - `transaction` system; optionally `World.canAfford/spend`.
   - ✅ `g5-transaction.mjs`. *Risk:* low.

7. **(OQ-7) `tap-emit` UI part** so G1's data-driven button works end-to-end.

8. **Catalog + docs.** Regenerate `packages/library/CATALOG.json` for the new
   parts; update `packages/sdk/README.md` + `packages/library/README.md` API
   docs. Bump both packages to `0.2.0`. Re-run the full harness suite (old
   baselines + new `g*` probes) and `gitcade validate` on `examples/pong` + a
   0.1.x game to prove no regression.

**Cross-cutting risks:**
- *Determinism (frozen):* every new code path uses `world.rng` and stays out of
  the in-tick order; the scene-queue drain and `endFrame` happen at tick *end*.
- *Additivity (hard constraint):* a 0.1.x scene must parse and run identically —
  add a regression probe that boots a current seed-game scene unchanged on 0.2.0.
- *Storage bridge (load-bearing):* G6 only *consumes* `world.storage`; no edits
  to `storage/protocol.ts`. Any temptation to add a wire message → HALT (frozen).
- *GameShell:* 0.2.0 only *adds* flow-as-data. Do not delete any game's GameShell
  in 3b — that is per-game Stage 4. The Snake demo (§G1) proves deletion is
  possible; it is not performed here.
