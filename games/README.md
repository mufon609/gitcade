# games/

The six published seed games — **Snake, Helicopter, Breakout, Tower Defense,
Idle Clicker, Survival Arena** — that prove the standard composes.

Each game composes **only** `@gitcade/library` parts (referenced as `partId@version`)
plus its own `config.json` and JSON scene definitions, with a thin host `main.ts`.
Each pins exact `sdkVersion` + `libraryVersion` from public npm — **not** workspace
links — because each game also lives as a standalone `gitcade-games/<slug>` repo that
the build worker resolves from the public registry. All six pin `@gitcade/sdk@1.10.1`
+ `@gitcade/library@1.10.0`.

## Tracking docs

- **[ENGINE-ROADMAP.md](./ENGINE-ROADMAP.md)** — the live engine-core bandaid log:
  concrete engine-gap workarounds that exist in shipped game source today (none open
  currently). When a game patches in host JS or a custom part what the engine should
  provide, it's logged here with its source location.
- **[PUBLISHED.md](./PUBLISHED.md)** — the published seed-repo registry (its repo-URL table
  is parsed by `platform/web/scripts/seed.ts`).
