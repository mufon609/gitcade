# games/

The six published seed games — **Snake, Helicopter, Breakout, Tower Defense,
Idle Clicker, Survival Arena** — that prove the standard composes.

Each game composes **only** `@gitcade/library` parts (referenced as `partId@version`)
plus its own `config.json` and JSON scene definitions, with a thin host `main.ts`.
Each pins exact `sdkVersion` + `libraryVersion` from public npm — **not** workspace
links — because each game also lives as a standalone `gitcade-games/<slug>` repo that
the build worker resolves from the public registry. In-tree pins: `@gitcade/sdk@0.7.0`
+ `@gitcade/library@0.7.0` (the 0.7.0 platformer-enabler minor — published npm is still
`0.6.0` until the release runbook ships it).

## Synthesis / planning docs

These are the living engine-and-library tracking docs (referenced from game source
comments and READMEs — they are the rationale trail, not scratch):

- **[INDIE-ROADMAP.md](./INDIE-ROADMAP.md)** — the **authoritative forward engine roadmap**:
  what the SDK runtime/schema needs to grow a professional-feeling 2D indie game (camera,
  collision/physics, rendering, audio, input, animation, juice, authoring), tiered and
  phased. Takes priority over the other engine notes.
- **[ENGINE-ROADMAP.md](./ENGINE-ROADMAP.md)** — the live shipped-game bandaid log (the open
  engine-core workaround, E8 entity visibility); forward direction lives in INDIE-ROADMAP.
- **[LIBRARY-GAPS.md](./LIBRARY-GAPS.md)** — `@gitcade/library` generalization candidates
  (proven custom parts awaiting a second consumer).
- **[GAME-IMPROVEMENTS.md](./GAME-IMPROVEMENTS.md)** — per-game isolated balance/content/asset
  work (cross-game engine capabilities live in INDIE-ROADMAP).
- **[PUBLISHED.md](./PUBLISHED.md)** — the published seed-repo registry (its repo-URL table
  is parsed by `platform/web/scripts/seed.ts`).
