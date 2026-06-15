# GitCade Engine & Library Capability Audit (Stage 1)

**Scope:** what the `@gitcade/sdk` runtime + the `@gitcade/library` parts *can and
cannot express*, every verdict backed by running a minimal repro through the
Stage-0 observation harness (`audit/harness/`) and pasting captured output.
**Audit only — nothing fixed this session.** Freeze is lifted; cleanest fixes are
designed for `0.2.0` and tagged `SCHEMA-CHANGE-0.2.0`.

**Method:** every probe boots through the real game path (`createGame` + the full
library registry) and is advanced deterministically; see
[`harness/README.md`](./harness/README.md). Reports cited as
`harness/out-<probe>.json`.

> **Read [`PARITY.md`](./PARITY.md) first.** All six *deployed* blobs are ~20 h
> stale (pre-`0.1.1`). Several defects you'd see by playing them are already fixed
> in source. This audit judges **current source**, rebuilt fresh.

---

## TL;DR

- The SDK runtime is a clean, deterministic ECS with solid *primitives* (movement,
  collision, query, spawn, events, config-binding, storage bridge). What it lacks
  is **everything that turns a single scene into a game**: it has no data-reachable
  **scene/flow control**, no **pointer-click semantics** (edge or pick), no
  **spatial/tilemap query**, no **placement helpers**, no **economy transaction**,
  and no **cross-scene persistence**.
- Those gaps are not hypothetical: **all six games abandon the "identical for every
  game" scaffold `main.ts`** and ship per-game host TypeScript (`GameShell`,
  custom `pointerdown` wiring) plus 600+ lines of `custom-behaviors/` precisely to
  paper over them. The bugs live in that hand-rolled layer.
- The one library bug the prompt suspected — **wave-spawner round-robin — is
  REFUTED in current source** (works; observed) and exists **only in the stale
  deployed helicopter blob** (see PARITY.md).

---

## A. Capability matrix

Legend — Supported: **yes** / **partial** / **no**. Evidence is `file:line` +
the harness observation.

| # | Capability | Supported | How it's reached | Code evidence | Observed behavior |
|---|---|---|---|---|---|
| 1 | **Scene / level transition from data** (title→play→over, L1→L2) | **no** | `Game.loadScene()` exists but is a **host** method; not on `world`, so no behavior/system can call it | `runtime/game.ts:112` (method on `Game`); `runtime/world.ts:30-129` (no such method); `systems/level-progression.ts:10-13` *"It does NOT swap scenes"* | Probe 1: `world` methods a part sees = `add,spawn,destroy,byId,query,nearest,cfg,prune`; `world.loadScene:false`. `harness/out-01-scene-transition.json` |
| 1b | **State preserved across a scene switch** | **no** | n/a — `loadScene` deletes every `world.state` key | `runtime/game.ts:117-122` | Probe 1: before `{gold:100}` → after `loadScene("two")` `{}`. Wiped. |
| 2 | **Wave spawn-point round-robin** | **yes** | `wave-spawner` system, `spawnPoints[]` | `systems/wave-spawner.ts:104` (`spawnCursor % spawnPts.length`) | Probe 2: 22 spawns cycle y=40→120→200…, `spawnCursor` monotonic→22. **Suspected NaN bug REFUTED.** `harness/out-02-wave-spawner.json` |
| 3 | **Pointer position in world coords** | **yes** | `world.input.activePointers()` | `runtime/input.ts:51,81-98` | Probe 3: during hold, `[{id:1,x:150,y:120,down:true}]`. `harness/out-03-pointer-pick.json` |
| 3b | **Click *edge* ("clicked this frame")** | **no** | none — pointer is deleted on `pointerup`; only the *held* state is queryable | `runtime/input.ts:51` (filters `down`), `:97-99` (delete on up); no `clicked`/`justPressed` | Probe 3: after release `activePointers()` = `[]`. A part running on the up-frame sees nothing → games edge-detect in host JS. |
| 3c | **Click *picking* (which entity/cell)** | **no** | none — no `entityAt`/`pick` | `runtime/world.ts` (only `byId/query/nearest`) | Probe 3: `world.entityAt:false`, `world.pick:false`. |
| 4 | **Tilemap queryable at runtime** (walkable/buildable/lane) | **no** | parsed in scene schema, never stored on `World` | `schema/scene.ts:6-14,37` (parsed) vs `runtime/world.ts:30-129` (no `tilemap`) | Probe 4: `hasTilemap:true` (scene) but `worldHasTilemap:false`, `world.tileAt:false`. `harness/out-04-tilemap-query.json` |
| 5 | **Spawn placement helpers** (grid-snap / free-cell / occupied) | **no** | `world.spawn(def)` / `spawnFrom` take a **literal** position only | `runtime/world.ts:75`; `library/util.ts:84-104` (`opts.position` literal) | Probe 5: 13 spawns all identical `(100,75)` — no distribution. `harness/out-05-spawn-placement.json` |
| 6 | **Currency accumulator** | **yes** | `currency` system | `systems/currency.ts:18-32` | Probe 6: gold 50→60→80 at 10/s passive. `harness/out-06-economy.json` |
| 6b | **Economy transaction primitive** (afford→deduct→do) | **partial** | only `upgrade-tree`'s single request-flag flow; no general `spend`/`canAfford` | `systems/upgrade-tree.ts:40-84` (one flag); no `world.spend` | Probe 6: `world.spend:false`, `world.canAfford:false`. Any other purchase = hand-rolled read/compare/write on `world.state`. |
| 7 | **Difficulty / level counter** | **partial** | `level-progression` ratchets a `world.state` counter + emits event | `systems/level-progression.ts:29-60` | Counter only; does **not** change scene or persist (see #1, #1b). |
| 7b | **Cross-scene / cross-run persistence** | **no** | `loadScene` wipes `world.state`; storage bridge persists only what a game explicitly writes via host JS | `runtime/game.ts:117-122`; `storage/bridge.ts` | Probe 1 (#1b). Persistence is entirely host-driven (e.g. idle-clicker `main.ts:61-64,77-87`). |

**Supporting primitives that *do* work** (spot-checked, not defects): movement
(`velocity`, `keyboard-axis` `runtime/behaviors/*`), AABB collision
(`runtime/systems/aabb-collision.ts`), tag query / nearest (`world.ts:91-110`),
runtime spawn (`world.ts:75`), event bus, `$cfg` resolution (`world.ts:116-119`),
deterministic RNG hook (`world.ts:62`), text/shape rendering
(`runtime/renderer.ts`), touch d-pad/button helpers (`ui/touch.ts`).

---

## B. Confirmed defects (each with a runnable repro + captured output)

### B-0 — REFUTED: wave-spawner round-robin is NOT broken in current source `[LIBRARY]`
- **Repro:** `node audit/harness/harness.mjs audit/harness/scenarios/02-wave-spawner.mjs`
- **Expected (if NaN bug):** all spawns at `spawnPoints[0]`.
- **Observed:** spawns cycle y = 40 → 120 → 200 → 40 … across 22 spawns;
  `spawnCursor` increments 1…22 (`out-02-wave-spawner.json`). The flagged line
  `wave-spawner.ts:104` reads `spawnPoints[s.spawnCursor % spawnPts.length]` — the
  fix, present and working.
- **Where the real bug is:** the **deployed** helicopter blob, which predates the
  fix and uses `spawnPoints[spawnedThisWave % P.length]` → pins to `spawnPoints[0]`
  → "obstacles only at the top." A **stale-artifact** defect, not a live engine
  bug. Full proof in `PARITY.md`. Remediation: **republish** (Stage 5), not a code
  change.

### B-1 — Scene transition is unreachable from data, and wipes all state `[ENGINE]`
- **Repro:** `scenarios/01-scene-transition.mjs`
- **Observed (`out-01-scene-transition.json`):**
  - API surface a part sees has **no** `loadScene`:
    `worldMethods: [add,spawn,destroy,byId,query,nearest,cfg,prune]`,
    `has["world.loadScene"]: false`.
  - Seeded `world.state.gold = 100` (via `currency`), then called the host-only
    `game.loadScene("two")`: `before {gold:100}` → `after {}`. **State wiped.**
- **Root layer `[ENGINE]`.** `Game.loadScene` lives on the host and clears
  `world.state`/entities (`game.ts:112-137`). Consequence: a game cannot move
  title→play→game-over or L1→L2 from data, and cannot carry score/coins/level
  across a transition.
- **Manifestation in the games:** *all six* implement screen flow in per-game host
  TS via a duplicated `GameShell` (`games/<g>/src/host/shell.ts`,
  `games/snake/src/main.ts:14,27` "title/pause/game-over/touch"), exactly the
  scaffold's forbidden zone (`templates/game-scaffold/src/main.ts` — *"IDENTICAL
  for every game … Do not put game logic in this file"*). Every game's `main.ts`
  is 56–217 lines vs the scaffold's 28.

### B-2 — No pointer click semantics: no edge, no pick `[ENGINE]`
- **Repro:** `scenarios/03-pointer-pick.mjs`
- **Observed (`out-03-pointer-pick.json`):** while held, the engine reports the
  pointer at world `(150,120)`; **after release `activePointers()` is `[]`**; and
  `world.entityAt`, `world.pick`, `input.clicked`, `input.justPressed` are all
  `false`. So a data-driven part cannot tell "a click happened this frame" or
  "what was clicked."
- **Root layer `[ENGINE]`.** `Input` exposes only the *held* pointer set
  (`input.ts:51`) and deletes pointers on `pointerup` (`input.ts:97-99`).
- **Manifestation:** tower-defense wires `canvas.addEventListener("pointerdown", …
  world.state.placeRequest = …)` in host TS (`games/tower-defense/src/main.ts:32`)
  and idle-clicker increments `world.state.clicks` the same way
  (`games/idle-clicker/src/main.ts:85-87`) — click detection is **outside** the
  SDK entirely. Picking ("which tower cell / which button") is then hand-rolled.

### B-3 — Tilemap is parsed but not queryable → no buildable/walkable zones `[ENGINE]`
- **Repro:** `scenarios/04-tilemap-query.mjs` (scene carries a real road tilemap)
- **Observed (`out-04-tilemap-query.json`):** `hasTilemap:true` (scene parsed it)
  but `worldHasTilemap:false` and `world.tileAt:false`. The runtime drops it.
- **Root layer `[ENGINE]`.** `schema/scene.ts:6-14` validates `tilemap`; `World`
  never stores it (`world.ts:30-129`); `renderer.ts` doesn't draw it either.
- **Manifestation:** tower-defense's `tower-build` snaps to a grid and checks
  *tower-vs-tower* occupancy (`custom-behaviors/index.ts:104-113`) but **cannot
  check the tile type** — there's nothing to query — so **towers are buildable on
  the road**. The reported TD defect is a direct consequence of this gap.

### B-4 — Spawn placement is literal-only `[ENGINE]/[LIBRARY]`
- **Repro:** `scenarios/05-spawn-placement.mjs`
- **Observed (`out-05-spawn-placement.json`):** 13 spawns, **all at identical
  `(100,75)`** — no scatter, no grid-snap, no free-cell.
- **Root layer `[ENGINE]` (primitive) / `[LIBRARY]` (no helper part).** `world.spawn`
  and `spawnFrom` accept a literal `position` only (`world.ts:75`, `util.ts:84-104`).
- **Manifestation:** Snake must hand-roll free-cell food placement
  (`snake/src/custom-behaviors/index.ts:213-273`, the comment: *"the one mechanic
  Snake needs that no @gitcade/library part provides"*). The "first food on the
  wall" symptom is a placement-helper gap.

### B-5 — Economy is a passive accumulator; no transaction primitive `[ENGINE]/[LIBRARY]`
- **Repro:** `scenarios/06-economy.mjs`
- **Observed (`out-06-economy.json`):** gold accrues 50→60→80; `world.spend:false`,
  `world.canAfford:false`.
- **Root layer.** `currency` only adds passive income/clamps (`currency.ts:18-32`).
  The single buy flow is `upgrade-tree`'s request flag (`upgrade-tree.ts:40-84`) —
  fine for upgrades, useless for "buy-and-place-a-thing."
- **Manifestation:** tower-defense re-implements affordability+deduct inline
  (`custom-behaviors/index.ts:97-122`); every economy game reinvents the
  transaction.

> **Not engine defects (correctly handled in source):** Snake's death-timing is
> solved by a custom `snake-guard` behavior exploiting the frozen tick order
> (`snake/custom-behaviors/index.ts:129-163`); restart double-fire is avoided by
> `attachOnce`/poll patterns (`tower-defense`, `idle-clicker`). These are
> *workarounds for the gaps above*, not separate bugs — they vanish once the gaps
> are closed.

---

## C. Gap register

Each gap: type `[MISSING PRIMITIVE]/[BROKEN]/[CONTRACT LIMIT]` · remediation class
`ADDITIVE-LIBRARY / SDK-PATCH-NO-CONTRACT / SCHEMA-CHANGE-0.2.0` · which seed games
it blocks and how.

### G1 — Data-driven scene/flow control + state hand-off  `[MISSING PRIMITIVE]` → **SCHEMA-CHANGE-0.2.0**
- **Why schema:** behaviors/systems need a way to *request* a scene change, and the
  scene set needs a flow contract. Cleanest design:
  1. Expose a flow API on `World` that parts can call: `world.requestScene(id, { keep?: string[] })` (queued, applied at end of tick by the host loop).
  2. Add an optional `flow`/`transitions` block to the manifest or scene schema (entry scene, `onEvent → scene` edges) so title→play→over is data.
  3. Make `loadScene` **preserve** an explicit `persist` key-set instead of nuking all of `world.state` (`game.ts:117-122`).
- **Repin/migration cost:** additive schema fields (old games parse unchanged); the
  `World` method is purely additive; the only behavioral change is opt-in state
  retention. Low. Games then delete their `GameShell` screen logic.
- **Blocks:** **all six** (every one hand-rolls title/play/game-over in host TS).
  Hardest-blocked: any game wanting real **levels/progression** (none have them
  today) — Snake, Breakout, Survival Arena, Tower Defense.

### G2 — Pointer click semantics: edge + pick  `[MISSING PRIMITIVE]` → **SDK-PATCH-NO-CONTRACT** (mostly)
- **Design:** on `Input`, add `justPressed()/justReleased()` (retain one frame of
  click-edge state instead of deleting on up — `input.ts:97-99`) and a tap list.
  On `World`, add `entityAt(x,y, tag?)` / `pick(x,y)` using existing AABB + layer
  order. These are **runtime-only additions** (no schema, no message protocol, no
  exported-type change) → patch-class, though shipping in `0.2.0` is cleanest.
- **Repin/migration cost:** none for existing games (additive API).
- **Blocks:** **Tower Defense** (click-to-place tower → currently host JS +
  `tower-build`), **Idle Clicker** (click-to-earn → host JS increments `clicks`).
  Any future point-and-click/menu game.

### G3 — Runtime tilemap query (buildable / walkable / lane)  `[CONTRACT LIMIT]` → **SCHEMA-CHANGE-0.2.0**
- **Design:** store the parsed `tilemap` on `World` and add
  `world.tileAt(x,y)` / `world.isBuildable(x,y)` / `world.cellRect(col,row)`. To
  make "buildable vs road vs lane" meaningful, extend `TilemapSchema`
  (`scene.ts:6-14`) with a small per-index property map (e.g.
  `layers`/`properties: { "1": { buildable:false, lane:true } }`). Renderer can
  optionally draw it.
- **Repin/migration cost:** schema gains optional fields (old scenes valid); games
  opt in. Low–medium (TD must move its grid logic onto the new API).
- **Blocks:** **Tower Defense** (towers-on-road is unfixable without this). Useful
  to any grid/lane game (a future Pac-Man-like, RTS, puzzle).

### G4 — Spawn placement helpers (grid-snap / free-cell / occupied)  `[MISSING PRIMITIVE]` → **ADDITIVE-LIBRARY** (+ optional SDK assist)
- **Design:** a library helper / system — `place-on-free-cell`, `snap-to-grid`,
  `random-free-cell(tag, tileSize, bounds)` — built on `world.query` + bounds. No
  schema change; pairs naturally with G3 when a tilemap exists. Can ship as a
  library part now (`ADDITIVE-LIBRARY`); a tiny `world` occupancy helper would make
  it cheaper but isn't required.
- **Repin/migration cost:** new library part → games bump `libraryVersion` to use
  it. Low.
- **Blocks:** **Snake** (free-cell food), **Tower Defense** (grid-snap, shared with
  G3), any spawner that must avoid overlaps.

### G5 — Economy transaction primitive  `[MISSING PRIMITIVE]` → **ADDITIVE-LIBRARY**
- **Design:** a generic `purchase`/`transaction` system or `world.state` helper:
  `request { key, cost, onOk events }` → afford-check → deduct → emit, generalizing
  `upgrade-tree`'s flag and TD's inline deduct. Pure library/runtime; no schema.
- **Repin/migration cost:** new library part; opt-in. Low.
- **Blocks:** **Tower Defense** (buy-and-place), **Idle Clicker** (already uses
  `upgrade-tree`; would dedupe its custom economy). Any shop/build game.

### G6 — Cross-scene / cross-run persistence  `[CONTRACT LIMIT]` → **SCHEMA-CHANGE-0.2.0** (rides on G1)
- **Design:** the `persist` key-set from G1 covers in-session cross-scene state;
  for cross-*run* (high score, prestige) add a declarative `save`/`load` binding so
  the storage bridge round-trips named `world.state` keys without host JS (today
  idle-clicker does this manually in `main.ts:61-64,77-87`).
- **Repin/migration cost:** additive; folds into G1's schema work. Low–medium.
- **Blocks:** **Idle Clicker** (prestige/coins must survive reload — host-coded
  today), any game with a persisted high score (Snake "Best", etc.).

---

## D. Headline — what good versions of the six games need that the engine lacks

Prioritized by breadth of impact (games blocked) and whether the symptom is
visible today:

1. **G1 — Data-driven scene/flow + state hand-off** *(SCHEMA-CHANGE-0.2.0)*.
   Blocks **all six**; the reason every game ships forbidden host `GameShell` code
   and the reason no game has real levels/progression. Highest leverage.
2. **G2 — Click edge + entity/cell pick** *(mostly SDK-PATCH)*. Unblocks **Tower
   Defense** and **Idle Clicker**, removes click wiring from host JS. Cheapest big
   win (no schema change).
3. **G3 — Tilemap runtime query** *(SCHEMA-CHANGE-0.2.0)*. The *only* fix for
   **Tower Defense** "towers on the road"; enables real lane/buildable maps.
4. **G4 — Spawn placement helpers** *(ADDITIVE-LIBRARY)*. Fixes **Snake** food and
   any overlap-free spawning; shippable without touching the contract.
5. **G5 — Economy transaction primitive** *(ADDITIVE-LIBRARY)*. De-duplicates
   **Tower Defense** / **Idle Clicker** economies.
6. **G6 — Declarative persistence** *(SCHEMA-CHANGE-0.2.0, rides G1)*. **Idle
   Clicker** prestige + every high-score.

**And before any of that — republish.** The single highest-impact action is
fixing the **parity gap** (PARITY.md): all six deployed blobs are ~20 h pre-`0.1.1`
and don't contain fixes that already exist in source (the helicopter round-robin
chief among them). Rebaseline every Stage-4 game audit on a *fresh* artifact, or
you will "fix" bugs that are already fixed.

---

## What Stage 2 (the remediation decision gate) must decide

1. **Approve the three `SCHEMA-CHANGE-0.2.0` items** (G1 scene-flow + state
   hand-off, G3 tilemap query, G6 persistence) — they're the only ones that touch
   the contract, and the freeze is lifted, so confirm scope + version target.
2. **Sequence G2/G4/G5** (no-contract / additive) — likely do these first; G2 is
   the cheapest unblock.
3. **Mandate a republish step** (Stage 5, or sooner) so Stage 4 audits run against
   fresh artifacts — and decide whether Stage 4 rebuilds per game before triage.
4. Decide whether `GameShell` collapses into G1's flow contract (delete per-game
   host screen code) as part of the 0.2.0 work or a later cleanup.
