# @gitcade/library

The **GitCade Component Library** — the logic half (Phase 2A): game-agnostic,
param-driven **behaviors** and **systems** built on the frozen
[`@gitcade/sdk`](../sdk). Phase 2B adds the presentational half (entities, art,
audio, UI, FX) and extends the same `CATALOG.json`.

Nothing here changes the SDK schema. Every part is a plain `BehaviorFn` /
`SystemFn` registered as a new **type** through the SDK's registration API
(`registry.registerBehavior` / `registry.registerSystem`). Games reference parts
by `type` in their scene/entity JSON and pin a `libraryVersion` in `game.json`.

## Install & register

```ts
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";

// SDK built-ins + every library part, on a fresh per-game registry:
const registry = createLibraryRegistry();
const game = createGame({ manifest, config, scenes }, { canvas, registry });
game.start();
```

`registerLibrary(registry)` adds the library onto an existing registry (e.g. one
that already has a game's `custom-behaviors/`).

## What's inside (27 parts, all MIT, all v1.0.0)

**Behaviors**
- *movement* — `move-4dir`, `move-platformer`, `move-topdown-360`,
  `move-grid-step`, `auto-scroll`, `follow-path`, `scale-by-state` *(0.2.1)*
- *combat* — `shoot`, `melee-swing`, `contact-damage`, `health-and-death`
- *ai* — `ai-chase`, `ai-flee`, `ai-patrol`, `ai-wander`, `ai-aim-and-fire`
- *interaction* — `collect-on-touch`, `trigger-zone`, `portal`

**Systems**
- *progression* — `score` (storage-persisted high score), `lives-respawn`,
  `timer-countdown`, `level-progression`
- *spawning* — `wave-spawner` (0.2.0: optional `placement: "free-cell"` scatter),
  `place-on-free-cell` *(0.2.0)*
- *rules* — `win-lose-conditions`
- *economy* — `simple-inventory`, `currency`, `upgrade-tree`, `transaction` *(0.2.0)*
- *persistence* — `persistence` *(0.2.0)* — declarative cross-run save/load

Each part ships: an implementation (`src/`), a JSON definition + metadata
(`parts/`), and a unit test (`test/`).

### New in 0.2.0

Built on the SDK 0.2.0 primitives (additive — existing games bump
`libraryVersion` to opt in):

- **`transaction`** *(system)* — generic afford → deduct → emit, backed by the SDK
  `world.canAfford`/`world.spend` assist. The buy-and-place economy `currency` and
  `upgrade-tree` don't cover.
- **`persistence`** *(system)* — round-trips `manifest.persist.keys` through the
  `world.storage` bridge: restores on boot (live value wins), saves on
  change/interval. No host JS, no wire-protocol change.
- **`place-on-free-cell`** *(system)* — on a trigger event, spawns a prototype at a
  verified-free grid cell (`world.rng`-deterministic, tilemap-aware). Replaces
  hand-rolled free-cell food/pickup placement.
- **`wave-spawner` `placement: "free-cell"`** — optional scatter across free grid
  cells; default `"literal"` is the exact 0.1.x behavior.
- **`tap-emit`** *(ui)* — emits a game event when an entity is clicked (reads the
  SDK click edge + topmost pick), so a button becomes a pure-data `scene.flow.on`
  edge: title → play → game-over with no host code.

### New in 0.2.1

Small additive engine-cleanup wave (existing 0.2.0 games keep building and behave
identically; see `audit/SDK-0.2.0-BUILD-NOTES.md` §0.2.1):

- **`scale-by-state`** *(behavior)* — ramp a live entity field (velocity or an
  entity-state value like hp) by `1 + perLevel*(level-1)` read from a `world.state`
  level counter. `set` / `multiply` / `once` modes generalize the hand-rolled
  difficulty ramps two games shipped (auto-scroll speed, per-enemy speed/hp).
- **`snapToGrid` / `randomFreeCell` are now re-exported from the package index**
  (`import { snapToGrid } from "@gitcade/library"`) — previously internal, so games
  inlined the grid-snap formula.
- **`place-on-free-cell` / `randomFreeCell` gain `excludeTags` (and `randomFreeCell`
  an `excludeCells`)** — block extra cells beyond `occupiedTag` (e.g. a marker at a
  soon-to-be-occupied cell), part `place-on-free-cell` bumped to v1.1.0.
- Engine-side (SDK 0.2.1): the persistence-vs-seeding race is fixed so a persisted,
  system-seeded key (e.g. `currency` coins) restores authoritatively on boot with no
  per-game scene-flow workaround. `persistence` now claims its keys and seed systems
  defer to the pending restore.

## The composition contract (inherited from the SDK)

- **All balance lives in `config.json`.** A part receives a numeric balance value
  only as a `"$cfg.<key>"` reference, resolved by the SDK before the function
  runs. The validator FAILS any non-structural numeric literal in params. Part
  default definitions in `parts/*.json` follow this rule (the catalog test
  enforces it).
- **Movement parts SET velocity**; order an SDK `velocity` behavior AFTER them so
  it integrates position (the same composition Pong uses). `move-grid-step` and
  the platformer floor-clamp write position directly.
- **Stateful systems namespace their scratch** under a `stateKey` param on
  `world.state`, so multiple instances coexist.
- **Persistence goes through `world.storage`** (the SDK postMessage bridge), never
  raw `localStorage`.

## The reuse proof

`proofs/` contains four distinct mini-genres built from the **same four parts** —
`ai-chase` + `contact-damage` + `wave-spawner` + `health-and-death` — proving the
parts are genuinely reusable. See [`proofs/README.md`](./proofs/README.md).

## CATALOG.json

`CATALOG.json` is the machine-readable index Phase 6 ingests. It is **generated**
from `parts/*.json` by `scripts/build-catalog.mjs` (`npm run catalog`) and
validated against `catalog.schema.json`. Do not hand-edit it — edit the per-part
files and regenerate.

## Scripts

```bash
npm run build      # tsup → dual ESM/CJS + d.ts
npm run catalog    # regenerate CATALOG.json from parts/
npm test           # vitest — one unit test per part + the catalog test
npm run typecheck  # tsc --noEmit
```
