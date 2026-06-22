# @gitcade/sdk

The **GitCade SDK** — the engine standard for AI-built, open-source browser
games. A lightweight TypeScript entity-component runtime for 2D Canvas
games, plus the schema, the storage bridge, and the publish-time validator.

This package is the **frozen contract** every GitCade game, the component library,
the build worker, and the marketplace depend on.

## Install

```bash
npm install @gitcade/sdk
```

Zero runtime dependencies beyond [`zod`](https://zod.dev). Games pin an **exact**
`sdkVersion` in `game.json`.

## What's inside

- **Schema** — Zod validators + inferred TS types for `game.json`, `config.json`,
  scenes, entities, behaviors, and systems. Every export is both a runtime
  validator and a static type.
- **Runtime** — a fixed-timestep entity-component game loop on HTML5 Canvas with
  built-in primitives (transform/velocity, AABB collision + events, keyboard +
  touch input, sprite/sheet/text rendering, audio that no-ops headlessly) and a
  registration API for adding new behavior/system **types**.
- **Storage bridge** — the `postMessage` protocol + adapters that are the only
  sanctioned persistence path for ecosystem games (no raw `localStorage`).
- **Validator** — `gitcade validate <dir>`, the publish gate.

## Scene flow, input & economy

Capabilities for expressing more of a game *as data*. Each is an **optional**
schema field or additive API, so a game that uses none of them runs on the bare
runtime unchanged.

- **Data-driven scene flow.** A scene may declare `flow: { on: { <event>:
  <sceneId> }, persist: [<stateKey>] }` — emitting the event transitions the
  scene, carrying the named `world.state` keys. Parts request a change from data
  via `world.requestScene(to, { keep? })`; the host drains the queue **between
  ticks**, so the frozen in-tick order is untouched.
- **Pointer click edge + pick.** `input.justPressed()` / `justReleased()` /
  `clicked()` expose a one-tick click edge (cleared by the loop each tick);
  `world.entityAt(x, y, tag?)` / `pick(...)` return the topmost entity under a point.
- **Runtime tilemap.** `TilemapSchema.properties` adds per-index flags;
  `world.tileAt(x, y)` / `isBuildable(x, y)` / `cellRect(col, row)` query the active
  scene's tilemap (stored on `world.tilemap`), and the renderer draws it.
- **Economy assist.** `world.canAfford(key, cost)` / `world.spend(key, cost)`
  — thin, non-contractual helpers over a `world.state` balance.

## Cross-run persistence

`manifest.persist: { keys, slot, everySeconds }` is surfaced on `world.persist`;
the `@gitcade/library` `persistence` system round-trips those keys through the
frozen `world.storage` bridge (no wire-protocol change).

`world.claimPersistKeys(keys)` / `isPersistPending(key)` / `resolvePersistKeys(keys)`
let a `persistence` system claim its declared keys synchronously on boot; a
seed-once system (e.g. the library `currency`) consults `isPersistPending` and
**defers** seeding while the async `storage.get` is in flight, so a saved value
restores authoritatively. The claim set is scene-scoped (reset on `loadScene`).

## Multi-level games

First-class support for games with multiple levels. Each piece is an **optional**
schema field or additive runtime/validator behavior; a game that sets neither
`scene.extends` nor `manifest.levels` runs without it.

- **Scene inheritance.** A scene may declare `extends: "<baseSceneId>"` to inherit
  a base scene's shell (entities, systems, size, background, music, tilemap, flow)
  and overlay only its own content — so a multi-level game authors the shared stage
  ONCE and each level is a thin override. The merge is id-keyed (base first, then
  the child, overriding by `id`); chains resolve bottom-up, cycle-guarded. Resolved
  in the `Game` constructor (`resolveSceneInheritance`), so the renderer/runtime
  never see `extends`.
- **Entity overrides (field-level).** Where the `entities` id-merge replaces an
  inherited entity WHOLE, `scene.overrides: [{ id, …partial }, …]` patches a single
  field of one. Each entry deep-merges onto the resolved entity of that id — nested
  objects recurse (`{ id:"paddle", position:{ x:200 } }` keeps the base `y`), arrays
  (`behaviors`/`tags`) replace when present, absent keys inherit — and the merged
  entity is re-parsed through the strict entity schema (a typo'd key or bad value
  fails loudly). So a level nudges the inherited paddle's width, repaints a HUD label,
  or points a behavior at a different `$cfg` slice without copying the entity.
  Resolved away with `extends`.
- **Level sequence.** `manifest.levels: [<sceneId>, …]` (+ optional
  `levelsComplete`) makes "a campaign of N levels" first-class. The reserved
  `flow.on` targets **`@next`** / **`@first`** resolve against it at emit time (a
  level never hard-wires its successor), and the runtime sets `world.state.level` to
  the active level's 1-based index — so `scale-by-state` / `wave-spawner` difficulty
  ramps track the stage with no per-scene config. `game.requestNextLevel()` is the
  programmatic companion to `@next`.
- **Validator cross-checks.** `gitcade validate` resolves every scene reference
  — `flow.on` targets, `extends`, `manifest.levels`/`levelsComplete`, and
  `entryPoint` — against the actual scene-id set, so a broken link fails the publish
  gate instead of surfacing at runtime. An `overrides` patch is held to the same bar:
  one whose `id` hits no entity (a dead patch) fails as `override-target-missing`.

## Quick start (composing a game from JSON)

```ts
import { createGame } from "@gitcade/sdk";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame({ manifest, config, scenes: [main] }, { canvas });
game.start();          // browser: requestAnimationFrame loop
// game.stepFrames(60); // headless: pure simulation (tests, validator)
```

## The behavior contract (frozen)

A behavior is a pure-ish function run once per entity per fixed update:

```ts
import type { BehaviorFn } from "@gitcade/sdk";

const drift: BehaviorFn = (entity, world, params, dt) => {
  entity.x += (params.speed as number) * dt; // params are $cfg-resolved
};
```

Register new **types** (never new schema shapes) onto a cloned default registry:

```ts
import { createDefaultRegistry } from "@gitcade/sdk";
const registry = createDefaultRegistry();
registry.registerBehavior("drift", drift);
```

## The two rules that make a game publishable

1. **No magic numbers.** Balance values live in `config.json` and are referenced
   as `"$cfg.<key>"`. Numeric literals in params are allowed only for structural
   keys (position, size, layer, frame indices, …).
2. **No raw storage.** Persist via `world.storage` (the bridge), never
   `localStorage`/`indexedDB`.

## CLI

```bash
gitcade validate path/to/game   # exit 0 = publishable
```

Validation: manifest + config + scene schemas, the storage rule (ecosystem tier),
the mechanical no-magic-numbers rule, `partId@version` catalog resolution against
the pinned `libraryVersion`, and a headless 60-frame smoke boot.

## Node-only validator API

```ts
import { validateGame } from "@gitcade/sdk/validate"; // uses fs/child_process
const result = await validateGame("path/to/game");
```

## License

MIT (code) · CC-BY-4.0 (assets).
