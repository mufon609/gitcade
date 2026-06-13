# @gitcade/sdk

The **GitCade SDK** — the engine standard for AI-built, open-source, community-governed
browser games. A lightweight TypeScript entity-component runtime for 2D Canvas
games, plus the schema, the storage bridge, and the publish-time validator.

This package is the **frozen contract** every GitCade game, the component library,
the build worker, the marketplace, and governance depend on.

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
