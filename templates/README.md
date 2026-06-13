# templates/

Scaffold templates that keep new creators on the compliant path.

| Template | Path | Phase | Purpose |
|---|---|---|---|
| Game scaffold | `templates/game-scaffold/` | Phase 1 | The starting point for every ecosystem game: `game.json`, `config.json`, `src/scenes/`, `src/custom-behaviors/`, `assets/`, a headless smoke test, and `dev`/`build`/`test` npm scripts. Published as a GitHub **template repo** in Phase 3 so new games start validation-clean. |

The locked-decision rationale: *the cheap path must be the compliant path.*
Scaffolding from this template, plus the publish-time validator and the build
pipeline, is the single enforcement system — there is no GitHub Actions CI on
game repos.

> Placeholder — `game-scaffold/` is created in Phase 1.
> See **MASTER-PLAN.md** (Phase 1) for its contents.
