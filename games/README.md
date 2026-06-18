# games/

The six published seed games — **Snake, Helicopter, Breakout, Tower Defense,
Idle Clicker, Survival Arena** — that prove the standard composes.

Each game composes **only** `@gitcade/library` parts (referenced as `partId@version`)
plus its own `config.json` and JSON scene definitions, with a thin host `main.ts`.
Each pins exact `sdkVersion` + `libraryVersion` from public npm — **not** workspace
links — because each game also lives as a standalone `gitcade-games/<slug>` repo that
the build worker resolves from the public registry. Current pins: `@gitcade/sdk@0.5.0`
+ `@gitcade/library@0.5.0`.

## Synthesis / planning docs

These are the living engine-and-library tracking docs (referenced from game source
comments and READMEs — they are the rationale trail, not scratch):

- **[ENGINE-ROADMAP.md](./ENGINE-ROADMAP.md)** — the open SDK-runtime / engine-core gap
  (E8, entity visibility) plus the Track-B genre unlocks.
- **[LIBRARY-GAPS.md](./LIBRARY-GAPS.md)** — `@gitcade/library` generalization candidates
  (proven custom parts awaiting a second consumer).
- **[GAME-IMPROVEMENTS.md](./GAME-IMPROVEMENTS.md)** — per-game isolated balance/content/asset
  work plus the deferred contract-change items.
- **[PUBLISHED.md](./PUBLISHED.md)** — the published seed-repo registry (its repo-URL table
  is parsed by `platform/web/scripts/seed.ts`).
