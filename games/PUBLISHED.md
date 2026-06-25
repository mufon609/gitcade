# PUBLISHED.md — Seed Game Repos

The seven seed games and the scaffold template, published as standalone public repos
in the **gitcade-games** GitHub org. Each game repo contains ONLY that game (not
the monorepo), builds from a clean clone against `@gitcade/sdk` + `@gitcade/library`
from public npm, and passes `gitcade validate`. No `.github/workflows` exist on any
repo (the platform pipeline is the CI — locked decision). The platform seed script
([`platform/web/scripts/seed.ts`](../platform/web/scripts/seed.ts)) consumes the
`repoUrl` list below.

Default branch: `main`. Visibility: public. Current release: all seven pin
`@gitcade/sdk@1.13.0` + `@gitcade/library@1.13.0`.

## Seed games

| Slug | Repo URL | Clone URL | Tier | Proves |
|---|---|---|---|---|
| snake | https://github.com/gitcade-games/snake | https://github.com/gitcade-games/snake.git | ecosystem | grid movement, collect-on-touch, score, game-over |
| helicopter | https://github.com/gitcade-games/helicopter | https://github.com/gitcade-games/helicopter.git | ecosystem | one-input auto-scroller, trigger-zone hazards, high score |
| breakout | https://github.com/gitcade-games/breakout | https://github.com/gitcade-games/breakout.git | ecosystem | collision physics, breakable-block, lives, level-progression |
| tower-defense | https://github.com/gitcade-games/tower-defense | https://github.com/gitcade-games/tower-defense.git | ecosystem | wave-spawner, path-following, currency, upgrade-tree, win/lose — **100% config-driven** |
| idle-clicker | https://github.com/gitcade-games/idle-clicker | https://github.com/gitcade-games/idle-clicker.git | ecosystem | currency, upgrade-tree, timers, offline progress via SDK storage — **100% config-driven** |
| survival-arena | https://github.com/gitcade-games/survival-arena | https://github.com/gitcade-games/survival-arena.git | ecosystem | ai-chase swarms, shoot, health, wave scaling, FX showcase |
| lumen | https://github.com/gitcade-games/lumen | https://github.com/gitcade-games/lumen.git | ecosystem | side-scrolling platformer; deterministic run-recorder "Echo" replay intro, two-level campaign with carry-over, and a level-select with three replay-driven modes (Echo / Race-the-Ghost / Time-Trial) — the showcase that drove sdk + library **1.13.0** |

## Scaffold template

| Slug | Repo URL | GitHub template? |
|---|---|---|
| game-scaffold | https://github.com/gitcade-games/game-scaffold | **yes** (`isTemplate: true`) — new creators start compliant |

## Build contract (for the build worker)

Each game repo, from a clean clone:

```bash
npm install                 # resolves the pinned @gitcade/sdk + @gitcade/library from public npm
npm run build               # prebuild syncs library art into public/assets, then Vite → /dist
npx gitcade validate .      # tier=ecosystem: schema + no-magic-numbers + no-raw-storage + smoke boot
```

- `npm run build` produces a self-contained static `/dist` (relative `base`), the
  artifact the worker uploads and the artifact server serves.
- The validator defers its smoke boot to each game's `npm test` (the games register
  library + custom parts the default SDK registry can't supply).
- `partId@version` provenance refs in the scenes resolve against the pinned
  `@gitcade/library` `CATALOG.json` installed in `node_modules` — exercised
  end-to-end by these standalone repos.

## Pending publication

Staged-but-unpublished games live below this marker. They are drafted and ready, but deliberately
**not** enqueued: [`seed.ts`](../platform/web/scripts/seed.ts) parses only the content *above* this
heading, and the release tooling iterates the `GAMES` list in
[`tools/release/lib.mjs`](../tools/release/lib.mjs) (which does not include them). A game stays here
until its pinned dependencies are live on public npm and its standalone repo exists.

_None currently pending — lumen was promoted to the Seed games table above on its 1.13.0 publish (2026-06-25)._
