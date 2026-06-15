# PUBLISHED.md — Phase 3 Seed Game Repos

> **0.3.0 PUBLISHED (2026-06-15) — all six live on `0.3.0`.**
> The input/focus/lifecycle/rendering/data work from the three audit batches (started by
> the "Space scrolls the page" report) shipped as `@gitcade/sdk@0.3.0` +
> `@gitcade/library@0.3.0` (a clean MINOR — additive `pause/resume/isPaused` + the
> `controls` manifest field, no breaking changes). Every game was repinned `0.2.1 → 0.3.0`
> (`game.json` + `package.json`), the library `CATALOG.json` regenerated to `0.3.0`, and
> the whole set re-verified: SDK 59/59, library 95/95, root `npm run build`/`npm test`
> green, all six `gitcade validate` PASS. Full detail:
> [`../audit/RELEASE-0.3.0.md`](../audit/RELEASE-0.3.0.md); per-issue outcomes:
> [`../audit/SHARED-ISSUES.md`](../audit/SHARED-ISSUES.md).
>
> **DONE — the `[PUBLISH]` external steps:** (1) `@gitcade/sdk@0.3.0` then
> `@gitcade/library@0.3.0` published to npm; (2) each game's `0.3.0` source pushed to its
> `gitcade-games/<slug>` GitHub repo (jumped `0.1.x → 0.3.0`), each re-verified from a clean
> clone; (3) all six MinIO `<slug>/main/` artifacts republished from the fresh 0.3.0 `/dist`
> (bundle hashes verified). Prior history (the 0.2.1 regression) is in
> [`../audit/REGRESSION.md`](../audit/REGRESSION.md).

---


The six seed games and the scaffold template, published as standalone public repos
in the **gitcade-games** GitHub org. Each game repo contains ONLY that game (not
the monorepo), builds from a clean clone against `@gitcade/sdk@0.1.0` +
`@gitcade/library@0.1.0` from public npm, and passes `gitcade validate`. No
`.github/workflows` exist on any repo (the platform pipeline is the CI — locked
decision). The Phase 4 seed script consumes the `repoUrl` list below.

Published 2026-06-13. Default branch: `main`. Visibility: public.

## Seed games

| Slug | Repo URL | Clone URL | Tier | Proves |
|---|---|---|---|---|
| snake | https://github.com/gitcade-games/snake | https://github.com/gitcade-games/snake.git | ecosystem | grid movement, collect-on-touch, score, game-over |
| helicopter | https://github.com/gitcade-games/helicopter | https://github.com/gitcade-games/helicopter.git | ecosystem | one-input auto-scroller, trigger-zone hazards, high score |
| breakout | https://github.com/gitcade-games/breakout | https://github.com/gitcade-games/breakout.git | ecosystem | collision physics, breakable-block, lives, level-progression |
| tower-defense | https://github.com/gitcade-games/tower-defense | https://github.com/gitcade-games/tower-defense.git | ecosystem | wave-spawner, path-following, currency, upgrade-tree, win/lose — **100% config-driven (governance flagship)** |
| idle-clicker | https://github.com/gitcade-games/idle-clicker | https://github.com/gitcade-games/idle-clicker.git | ecosystem | currency, upgrade-tree, timers, offline progress via SDK storage — **100% config-driven (governance flagship)** |
| survival-arena | https://github.com/gitcade-games/survival-arena | https://github.com/gitcade-games/survival-arena.git | ecosystem | ai-chase swarms, shoot, health, wave scaling, FX showcase |

## Scaffold template

| Slug | Repo URL | GitHub template? |
|---|---|---|
| game-scaffold | https://github.com/gitcade-games/game-scaffold | **yes** (`isTemplate: true`) — new creators start compliant |

## Build contract (for the Phase 4A worker)

Each game repo, from a clean clone:

```bash
npm install                 # resolves @gitcade/sdk@0.1.0 + @gitcade/library@0.1.0 from public npm
npm run build               # prebuild syncs library art into public/assets, then Vite → /dist
npx gitcade validate .      # tier=ecosystem: schema + no-magic-numbers + no-raw-storage + smoke boot
```

- `npm run build` produces a self-contained static `/dist` (relative `base`), the
  artifact the worker uploads and the artifact server serves.
- The validator defers its smoke boot to each game's `npm test` (the games register
  library + custom parts the default SDK registry can't supply).
- `partId@version` provenance refs in the scenes resolve against the pinned
  `@gitcade/library@0.1.0` `CATALOG.json` installed in `node_modules` — exercised
  end-to-end by these standalone repos.
