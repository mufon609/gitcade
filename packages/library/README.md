# @gitcade/library

The **GitCade Component Library** — game-agnostic, param-driven parts built on the
frozen [`@gitcade/sdk`](../sdk): the logic half (**behaviors** and **systems**) and
the presentational half (**entities**, **UI**, **FX**, and generated **assets** —
art, audio, tilesets), all indexed in one `CATALOG.json`.

Nothing here changes the SDK schema. Logic parts are plain `BehaviorFn` / `SystemFn`
implementations registered as new **types** through the SDK's registration API
(`registry.registerBehavior` / `registry.registerSystem`); presentational parts are
data/asset definitions. Games reference parts by `type` (or by asset id) in their
scene/entity JSON and pin a `libraryVersion` in `game.json`.

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

## What's inside (95 parts, all MIT)

Most parts are `v1.0.0`; some carry additive revisions (e.g. `move-platformer`
`v1.3.0`, `camera-follow` `v2.0.0`). Each part's exact semver lives in `CATALOG.json`.

**Behaviors** *(per-entity, run each tick)*
- *movement* — `move-4dir`, `move-platformer`, `move-topdown-360`, `move-grid-step`,
  `auto-scroll`, `follow-path`, `scale-by-state`, `face-angle`, `face-velocity`,
  `sprite-state-machine`, `tween`
- *combat* — `shoot`, `melee-swing`, `contact-damage`, `health-and-death`
- *ai* — `ai-chase`, `ai-flee`, `ai-patrol`, `ai-wander`, `ai-aim-and-fire`
- *interaction* — `collect-on-touch`, `trigger-zone`, `portal`

Platformer collision is **not** a behavior — it's the SDK's collision-resolution
PHASE (`World.resolveBodies()` over a `collider` component: solid push-out, slopes,
carry, two-body push).

**Systems** *(per-scene, run before behaviors)*
- *progression* — `score`, `lives-respawn`, `timer-countdown`, `level-progression`
- *spawning* — `wave-spawner` *(optional `placement: "free-cell"` scatter +
  level-driven `densityPerLevel`/`intervalPerLevel` ramp)*, `place-on-free-cell`
- *rules* — `win-lose-conditions`, `stat-modifier`
- *economy & persistence* — `currency`, `simple-inventory`, `upgrade-tree`,
  `transaction`, `persistence`
- *camera* — `camera-follow`, `camera-shake`
- *input* — `input-actions` · *ui binding* — `format-binding`

**Entities** *(spawnable prototypes)* — `player-blob`, `player-humanoid`,
`player-ship`, `enemy-chaser`, `enemy-patroller`, `enemy-shooter`, `enemy-swarm`,
`bullet`, `laser`, `lobbed-bomb`, `coin`, `gem`, `key`, `powerup-capsule`,
`breakable-block`, `moving-platform`, `snake-segment`, `spike`, `wall`

**UI** — `hud-health-bar`, `hud-score`, `hud-timer`, `hud-wave-counter`, `menu-title`,
`menu-pause`, `menu-game-over`, `tap-emit`, `key-emit`, `touch-controls`

**FX** — `dust`, `explosion`, `sparkle`, `trail`, `screen-shake`, `screen-flash`,
`screen-fade`

**Assets** *(generated deterministically by `scripts/gen-assets.ts`)*
- *world* — `background-gradient`, `background-starfield`, `background-parallax-2layer`,
  `tileset-grass`, `tileset-dungeon`, `tileset-space`, `tileset-neon-arcade`,
  `camera-fixed`, `camera-auto-scroll`
- *audio* — `music-action`, `music-menu`, and the `sfx-*` set (`click`, `collect`,
  `explode`, `hit`, `jump`, `lose`, `shoot`, `win`)

Logic parts (behaviors, systems) each ship an implementation (`src/`), a JSON
definition (`parts/`), and a unit test (`test/`); entities, UI, FX, and assets are
data/generated definitions under `parts/`.

### Parts & helpers built on the SDK data primitives

- **`transaction`** *(system)* — generic afford → deduct → emit, backed by the SDK
  `world.canAfford`/`world.spend` assist, for economies `currency` and `upgrade-tree`
  don't cover.
- **`persistence`** *(system)* — round-trips `manifest.persist.keys` through the
  `world.storage` bridge: restores on boot (live value wins), saves on
  change/interval. No host JS, no wire-protocol change.
- **`place-on-free-cell`** *(system)* — on a trigger event, spawns a prototype at a
  verified-free grid cell (`world.rng`-deterministic, tilemap-aware), so free-cell
  food/pickup placement is data, not host code.
- **`wave-spawner` `placement: "free-cell"`** — optional scatter across free grid
  cells (default `"literal"` places at exact coordinates); `densityPerLevel` /
  `intervalPerLevel` scale wave size + cadence by `world.state.level` — the
  spawn-pressure half of difficulty (the speed half is `scale-by-state`).
- **`tap-emit`** *(ui)* — emits a game event when an entity is clicked (reads the
  SDK click edge + topmost pick), so a button is a pure-data `scene.flow.on`
  edge: title → play → game-over with no host code.
- **`scale-by-state`** *(behavior)* — ramp a live entity field (velocity or an
  entity-state value like hp) by `1 + perLevel*(level-1)` read from a `world.state`
  level counter; `set` / `multiply` / `once` modes.
- **`snapToGrid` / `randomFreeCell`** are exported from the package index
  (`import { snapToGrid } from "@gitcade/library"`) for games that need the
  grid-snap / free-cell math directly; `place-on-free-cell` / `randomFreeCell` take
  `excludeTags` (and `randomFreeCell` an `excludeCells`) to block extra cells beyond
  `occupiedTag`.

### Host helpers (code exports, not data-parts)

A few helpers are plain code the host page wires up, NOT registered runtime types — they orchestrate
the canvas / rAF loop / a second Game, which a frozen behavior/system can't. Each is a pure,
unit-testable controller plus a thin browser glue that no-ops cleanly headless; none touch the SDK
schema or `CATALOG.json`. `ScreenEffects` + `attachScreenEffects` (camera shake / screen flash /
fade) and `LibraryAudioPlayer` (synthesized SFX + chiptune music) are two; the **replay intro** is
the third.

**Replay intro** — `ReplayIntro` + `attachReplayIntro` + `parseRecording`. A skippable *Echo* of the
player's last run, played back on the canvas as a watchable intro before live play begins, built on
the SDK's run-recording primitive (`createReplay`). The recording re-simulates byte-for-byte through
a fresh seeded Game, so the intro is a deterministic replay, not a video. Replay and live play are
temporally separate: the intro plays the recording to completion (or the player skips it), then hands
control back via `onDone`, where the caller starts the live game.

```ts
import { createGame } from "@gitcade/sdk";
import { ReplayIntro, attachReplayIntro, parseRecording } from "@gitcade/library";

// The player's last run for this level, persisted as a JSON string through the storage bridge.
// parseRecording returns null on a missing / corrupt / stale blob — then there's simply no intro.
const prior = parseRecording((await storage.get(`run:${entryLevel}`)) ?? "");

// The live game records THIS run (for next time); starting it is the handoff target.
const live = createGame(raw, { canvas, registry, audio, storage, seed: SEED, record: true });
const startLive = () => live.start();

if (prior) {
  // A second Game, seeded + entered identically to the recorded run and NOT started — the controller
  // drives it. `attachInput: false` so the watching player's keys don't leak into the re-simulation.
  const replayGame = createGame(raw, { canvas, registry, seed: prior.seed, entrySceneId: prior.sceneId, attachInput: false });
  const intro = new ReplayIntro({ game: replayGame, recording: prior, onDone: startLive });
  attachReplayIntro(intro, canvas, { prompt: "ECHO OF YOUR LAST RUN — press any key to skip" });
} else {
  startLive();
}
```

`ReplayIntro` is the pure controller — `tick(dt)` advances playback at the recorded fixed-timestep
pace, `skip()` ends it early, and `onDone({ skipped, atFrame })` fires exactly once (completion OR
skip). `attachReplayIntro` runs the rAF loop (renders the replay + a tint / skip-prompt / progress
overlay, wires the skip keys + a pointer tap) and returns an idempotent `stop()`; with no animation
clock it drives the replay to completion so `onDone` still resolves and a non-browser host goes
straight to live.

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

`CATALOG.json` is the machine-readable index the marketplace ingests. It is **generated**
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
