# tools/release — the GitCade release runbook (scripted)

A release of `@gitcade/sdk` + `@gitcade/library` has two halves:

1. **In-repo** (plain npm + git): build, test, `gitcade validate`, `npm publish`,
   push the monorepo. Well-understood and easy.
2. **Outward-facing** (the part the patch protocol leaves to a human): push each
   game's source to its standalone **`gitcade-games/<slug>`** repo, and republish
   the six **MinIO/S3** `{slug}/main/` artifacts. This was previously a manual,
   undocumented sequence — these scripts make it repeatable.

Every change still follows the **patch protocol** (see [CLAUDE.md](../../CLAUDE.md)):
ship only PATCH-clean / additive changes, bump the version, `npm pack --dry-run`,
then run this runbook. The scripts don't decide *what* to release — they execute a
release whose versions/pins are already committed.

## The scripts

| Script | Does |
|---|---|
| `release.mjs <phase\|all>` | Orchestrator — runs the phases below in the safe order. |
| `sync-game-repos.mjs` | Mirrors each monorepo game (committed source, via `git archive`) into `gitcade-games/<slug>`, re-verifies from the clean clone against **public npm** (`npm install` → `build` → `gitcade validate`), commits + pushes only on change. |
| `publish-artifacts.mjs` | Builds each game's `/dist` and uploads it to the bucket under the frozen `{slug}/{branch}/{path}` key with worker-identical content-types. |
| `lib.mjs` | Shared helpers (env parsing, the game list, S3 client, content-types). |

### Phases (`release.mjs`)

```
verify    npm run build + npm test + gitcade validate (all six games)
npm       publish @gitcade/sdk@<v> then @gitcade/library@<v>  (skips a version already on npm)
monorepo  git push origin main
repos     sync-game-repos.mjs   (needs the npm phase done first — clones build against public npm)
artifacts publish-artifacts.mjs (needs Postgres-free; just MinIO + a local build)
```

`<v>` is read from `packages/sdk/package.json` (sdk + library release in lockstep).

## Usage

```bash
# Full release, in order (verify → npm → monorepo → repos → artifacts):
node tools/release/release.mjs all

# A single phase:
node tools/release/release.mjs artifacts
node tools/release/release.mjs repos --only=snake,helicopter

# Always dry-run first for the outward-facing phases:
node tools/release/release.mjs repos --dry-run
node tools/release/release.mjs artifacts --dry-run

# Lower-level, direct:
node tools/release/sync-game-repos.mjs --only=tower-defense --no-push
node tools/release/publish-artifacts.mjs --only=idle-clicker --dry-run
```

### Flags

- `--only=a,b` — restrict to specific game slugs.
- `--dry-run` — print what would happen; no npm publish, no git push, no S3 write.
- `--no-verify` (sync) — skip the clean-clone install/build/validate (faster, less safe).
- `--no-push` (sync) — commit the game repos locally but don't push.
- `--no-build` (artifacts) — upload an existing `/dist` instead of rebuilding.
- `--branch=main` (artifacts) — artifact branch prefix (default `main`).
- `--message="..."` (repos) — the game-repo commit subject.

## Prerequisites

- **npm**: logged in to the `@gitcade` scope (`npm whoami`). `npm publish` of a
  version is **irreversible** — the `npm` phase self-skips a version already live.
- **git/ssh**: push access to the `gitcade-games` org (the `repos` phase pushes to
  `git@github.com:gitcade-games/<slug>.git`). `rsync` must be on PATH.
- **MinIO/S3**: the `S3_*` keys in the repo-root `.env` (MinIO on `:9000` locally;
  `S3_FORCE_PATH_STYLE=true`). The client honors path-style so the same code works
  against real S3/R2.
- The `repos` phase **requires the `npm` phase to have run** (the clean-clone
  `npm install` resolves `@gitcade/*` from public npm).

## What is NOT automated (on purpose)

The version bump, the per-game repins/migrations, the catalog regen, and the docs
(`CONVENTIONS.md`, `LIBRARY-GAPS.md`, `games/GAME-IMPROVEMENTS.md`) are authored
changes that land in the **monorepo commit** before a release. These scripts only
*propagate* that committed state outward. They also never touch the frozen
artifact-server URL/headers or the storage protocol — `publish-artifacts.mjs`
mirrors the worker's upload (content-type only); cache + per-game CSP headers are
the artifact server's job on serve.
