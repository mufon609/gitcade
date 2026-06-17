# PUBLISHED.md — Phase 3 Seed Game Repos

> **0.3.2 PUBLISHED (2026-06-16) — all six live on `0.3.2`.**
> The second games+engine audit synthesis shipped as `@gitcade/sdk@0.3.2` +
> `@gitcade/library@0.3.2` — a clean **PATCH** (additive, no frozen-contract change):
> renderer honors `entity.rotation` + `scale` (the declared-but-ignored slot) + a new
> `face-angle` behavior; the music synth off-beat-note-drop fix (all six games); an
> `ai-aim-and-fire@1.1.0` priority-targeting + `follow-path@1.1.0` `__pathProgress`;
> `formatCompact` + `cappedOfflineGain` library utils; and two behavior-ordering validator
> advisories. Four games adopted new capabilities (helicopter → `face-angle` ship bank;
> tower-defense → "first" targeting; idle-clicker → `formatCompact`/`cappedOfflineGain`;
> survival-arena → the dead-speed-ramp **fix**), snake/breakout repinned only. Per-game
> isolated work split into [`GAME-IMPROVEMENTS.md`](GAME-IMPROVEMENTS.md). Re-verified: SDK
> 79/79, library 107/107, root build + test green, all six `gitcade validate` PASS (incl.
> from a clean clone against public npm).
>
> **DONE — external steps (scripted via [`tools/release/`](../tools/release/)):** (1)
> `@gitcade/sdk@0.3.2` then `@gitcade/library@0.3.2` published to npm; (2) each game's
> `0.3.2` source pushed to its `gitcade-games/<slug>` repo, each re-verified from a clean
> clone; (3) all six MinIO `<slug>/main/` artifacts republished (the artifact server serves
> them HTTP 200); (4) monorepo `main` pushed. The release runbook is now scripted —
> `node tools/release/release.mjs all`.

> **0.3.1 PUBLISHED (2026-06-16) — superseded by 0.3.2 above.**
> The 0.3.0 game-audit synthesis shipped as `@gitcade/sdk@0.3.1` +
> `@gitcade/library@0.3.1` — a clean **PATCH** (additive, no frozen-contract change):
> `background.layers` parallax in the renderer, `world.whenRestored()` + a
> `persist-restored` event, a `throttle` FX helper + authoring conventions, two
> non-failing validator advisories, and `properties[idx].color` tilemap tinting. Every
> game was repinned `0.3.0 → 0.3.1` and migrated to the new capabilities (helicopter →
> declarative `background.layers`, dropping its `bgScrollVx` key; idle-clicker → offline
> credit via `whenRestored`; etc.). Re-verified: SDK 73/73, library 97/97, root build +
> test green, all six `gitcade validate` PASS. Conventions:
> [`../packages/library/CONVENTIONS.md`](../packages/library/CONVENTIONS.md); synthesis
> record: [`LIBRARY-GAPS.md`](LIBRARY-GAPS.md).
>
> **DONE — external steps:** (1) `@gitcade/sdk@0.3.1` then `@gitcade/library@0.3.1`
> published to npm; (2) each game's `0.3.1` source pushed to its `gitcade-games/<slug>`
> repo, each re-verified from a clean clone; (3) all six MinIO `<slug>/main/` artifacts
> republished from the fresh 0.3.1 `/dist`; (4) monorepo `main` pushed.

> **0.3.0 PUBLISHED (2026-06-15) — superseded by 0.3.1 above.**
> The input/focus/lifecycle/rendering/data work from the three audit batches (started by
> the "Space scrolls the page" report) shipped as `@gitcade/sdk@0.3.0` +
> `@gitcade/library@0.3.0` (a clean MINOR — additive `pause/resume/isPaused` + the
> `controls` manifest field). Every game was repinned `0.2.1 → 0.3.0`, the library
> `CATALOG.json` regenerated to `0.3.0`, all six `gitcade validate` PASS, npm + the six
> `gitcade-games/<slug>` repos + MinIO all published. (The detailed 0.3.0 release /
> shared-issues / regression docs lived under `audit/`, removed after the pass — recover
> from git history if needed.)

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
