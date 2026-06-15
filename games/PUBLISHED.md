# PUBLISHED.md — Phase 3 Seed Game Repos

> **Stage 5a status (2026-06-15) — all six on `0.2.1`, republished to LOCAL MinIO.**
> The capstone regression repinned every game to `@gitcade/sdk@0.2.1` +
> `@gitcade/library@0.2.1` (`game.json` + `package.json`), applied the 0.2.1 engine
> cleanups (helicopter/survival `scale-by-state`, tower-defense `snapToGrid` import,
> idle-clicker play-scene persistence collapse, snake `excludeTags`), and re-verified
> the whole set: all six `gitcade validate` PASS, `npm run build` clean, every smoke
> suite green, headless replays clean (0 console/page errors), the three original
> complaints re-confirmed fixed, and all six **fresh 0.2.1 `/dist` builds republished
> to MinIO `<slug>/main/`** (30 objects each; the served `index.html` references the
> new bundle hash — verified via the S3 API). Evidence: [`../audit/REGRESSION.md`](../audit/REGRESSION.md).
>
> **STILL DEFERRED — Stage 5c go-live (owner's discretion), not done here:**
> (1) `npm publish @gitcade/sdk@0.2.1` + `@gitcade/library@0.2.1` (the human `[PUBLISH]`
> gate); (2) push each game's `0.2.1` source to its `gitcade-games/<slug>` GitHub repo;
> (3) a worker-faithful rebuild (clone → `npm install` from public npm → build → upload)
> once the packages are on npm. The local MinIO blobs above are the bridge until then.

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
