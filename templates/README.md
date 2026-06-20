# templates/

Scaffold templates that keep new creators on the compliant path.

| Template | Path | Purpose |
|---|---|---|
| Game scaffold | `templates/game-scaffold/` | The starting point for every ecosystem game: `game.json`, `config.json`, `src/scenes/`, `src/custom-behaviors/`, `assets/`, a headless smoke test, and `dev`/`build`/`test` npm scripts. Published as a GitHub **template repo** so new games start validation-clean. |

The locked-decision rationale: *the cheap path must be the compliant path.*
Scaffolding from this template, plus the publish-time validator and the build
pipeline, is the single enforcement system — there is no GitHub Actions CI on
game repos.
