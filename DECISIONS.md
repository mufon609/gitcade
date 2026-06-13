# DECISIONS.md — GitCade Build Log

Every phase **appends** its assumptions and reversible requirement choices here
so later phases inherit full context. Newest phase at the bottom. Never
contradict an earlier entry; if reality forces a change, add a new dated entry
explaining it. This file is created in Phase 0 and is a handoff artifact for
every phase that follows.

Format: one section per phase, dated, listing each assumption/decision with a
one-line rationale. Locked Architecture Decisions live in **MASTER-PLAN.md §2**
and are NOT repeated here — this file is only for choices made *during a build
session* that were not already locked.

---

## Phase 0 — Infrastructure & Skeleton — 2026-06-13

Scope this session: monorepo skeleton + environment plumbing only, no app code.
The repo arrived partially set up (CLAUDE.md, MASTER-PLAN.md, ENVIRONMENT.md,
`setup/`, populated `.env`, `.gitignore`); those were left intact.

- **npm workspaces, not pnpm/yarn/turbo.** ENVIRONMENT.md mandates npm ("Use
  npm. Never `sudo npm`."), so the root `package.json` uses native npm
  workspaces. Reversible: a workspace-aware task runner can be layered on later
  without restructuring.
- **Workspace globs `packages/*`, `games/*`, `platform/*`, `templates/*`.** Glob
  patterns (not an explicit member list) so each later phase can drop in its
  package directory without editing root config. Matches the MASTER-PLAN §3
  layout exactly.
- **Root `package.json` is `private: true`, version `0.0.0`.** The monorepo root
  is never published; only `packages/sdk` and `packages/library` publish, each
  with their own version (SDK starts 0.1.0 in Phase 1). Prevents an accidental
  `npm publish` of the whole tree.
- **Root scripts fan out with `--workspaces --if-present`.** `npm run
  build/test/lint` at the root delegate to whatever members define them; safe to
  run now (no members yet → no-op) and grows automatically.
- **Engines pin `node >=22`.** Matches the installed Node 22 LTS
  (ENVIRONMENT.md); records the floor for clean clones in later phases.
- **Top-level dirs created with placeholder READMEs only.** `packages/`,
  `games/`, `platform/`, `templates/` exist with READMEs describing what each
  later phase fills in. Sub-package dirs (`sdk/`, `library/`, `game-scaffold/`)
  are intentionally **not** created — that is Phase 1+ work and would cross the
  phase boundary.
- **`infra/` holds docs only in v1.** No IaC/compose files committed here yet —
  the local infra stack (Postgres + MinIO) is provisioned by
  `setup/setup-kali.sh` per ENVIRONMENT.md, and prod IaC is out of scope until
  deploy time. `infra/README.md` is the topology contract (app/worker/storage
  three-zone diagram) derived from the Locked Architecture Decisions.
- **`setup/.env.example` left unchanged.** Verified it already documents every
  variable on the Phase 0 key list (DATABASE_URL, GITHUB_ORG,
  GITHUB_OAUTH_ID/SECRET, GITHUB_APP_ID/PRIVATE_KEY, GITHUB_WEBHOOK_SECRET,
  WEBHOOK_PROXY_URL, S3_ENDPOINT/BUCKET/KEYS, S3_FORCE_PATH_STYLE,
  ARTIFACT_BASE_URL, ARTIFACT_SERVER_PORT, BUILDER_IMAGE, QUEUE_POLL_INTERVAL_MS,
  NEXTAUTH_SECRET/URL) with per-key comments. Nothing genuinely missing, so
  nothing added — avoids drift from the curated template.
- **`.gitignore`: appended `node_modules/` and build outputs.** The existing
  entries (secrets, `.env`, `*.pem`) were preserved verbatim; an npm-workspaces
  repo must not commit `node_modules/` or `dist/`/`.next/` build output. Additive
  and reversible.
- **No CORE blockers hit.** Node 22, npm 10, git, `gh`, Docker (Postgres + MinIO)
  all present per ENVIRONMENT.md; no BLOCKED.md created this session.
