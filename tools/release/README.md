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
| `policy.mjs` | **The one source of truth** — role→pin policy: closed path classifier, expected pins per role, audit invariants, publish planning. Pure + tested (`npm run release:test`). |
| `release.mjs <doctor\|sync\|gate\|publish>` | The four release commands (below), driven by `policy.mjs`. |
| `sync-game-repos.mjs` | Mirrors each monorepo game (committed source, via `git archive`) into `gitcade-games/<slug>`, re-verifies from the clean clone against **public npm** (`npm install` → `build` → `gitcade validate`), commits + pushes only on change. |
| `publish-artifacts.mjs` | Builds each game's `/dist` and uploads it to the bucket under the frozen `{slug}/{branch}/{path}` key with worker-identical content-types. |
| `lib.mjs` | Shared helpers (env parsing, the game list, S3 client, content-types). |

### Commands (`release.mjs`)

```
doctor   role-classified pin audit + invariants + read-only creds check; non-zero on problems
sync     apply the role pin policy (internal→"*", games→exact current, library peer→^range)
         + regenerate CATALOG.json + refresh the lockfile. Idempotent (no-op when already clean).
gate     `npm ci` (clean no-flags install) + build + test + validate:pong + validate:proofs
         + `npm pack --dry-run` per publishable package AT ITS OWN VERSION.
publish  per-package npm publish (reads EACH package's own version; skips one already on npm)
         → push monorepo → sync game repos → (re)publish MinIO artifacts. First-class --dry-run.
```

sdk and library are **not assumed to be in lockstep** — `publish` reads each package's own
version independently and skips any already live (so a re-run after a partial failure is safe).

## Usage

```bash
# Cut a release (see ../../RELEASE.md):
npm run release:doctor                  # audit; fix any issue before continuing
npm run release:sync                    # bring pins/catalog/lockfile to policy
npm run release:gate                    # full clean-install gate + pack dry-run
npm run release:publish -- --dry-run    # rehearse the whole publish, mutating nothing
npm run release:publish                 # the real thing

# Lower-level, direct (both honor --dry-run):
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
  version is **irreversible** — `publish` self-skips a version already live.
- **git/ssh**: push access to the `gitcade-games` org (publish's game-repo step pushes
  to `git@github.com:gitcade-games/<slug>.git`). `rsync` must be on PATH.
- **MinIO/S3**: the `S3_*` keys in the repo-root `.env` (MinIO on `:9000` locally;
  `S3_FORCE_PATH_STYLE=true`). The client honors path-style so the same code works
  against real S3/R2.
- `doctor` checks all three read-only and `publish` refuses on a real run if any is
  missing. The game-repo step **requires the npm publish to have run first** (the
  clean-clone `npm install` resolves `@gitcade/*` from public npm).

## What is NOT automated (on purpose)

The version bump, the per-game repins/migrations, the catalog regen, and the docs
(`CONVENTIONS.md`, `LIBRARY-GAPS.md`, `games/GAME-IMPROVEMENTS.md`) are authored
changes that land in the **monorepo commit** before a release. These scripts only
*propagate* that committed state outward. They also never touch the frozen
artifact-server URL/headers or the storage protocol — `publish-artifacts.mjs`
mirrors the worker's upload (content-type only); cache + per-game CSP headers are
the artifact server's job on serve.
