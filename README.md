# GitCade

**Git for Gamers** — a platform where AI-built, open-source browser games are
published, played, forked, remixed, and governed by community vote.

Three pillars no platform combines today:

- **GitHub-style forking** — every game is a git repo; every branch is playable
  in one click. Fork a game, rebalance it, and share a side-by-side compare URL.
- **OSRS-style governance** — communities vote on proposals at a 70% threshold.
  Most proposals are one-line `config.json` diffs that auto-commit on pass. Lose
  the vote? Fork it with the patch applied in one click — democracy with an exit
  door.
- **A component marketplace as the standard** — games are assembled from
  interoperable parts (entities, behaviors, systems, art, audio, UI, FX). Browse
  what every game is made of, and remix a fork by swapping parts — no code.

Scope for v1: single-player browser games only.

> **Status:** v1 feature-complete. The SDK and component library are published
> as `@gitcade/sdk` and `@gitcade/library`; six seed games run on them; the
> build worker, artifact server, and the full Next.js platform (publish, play,
> fork, marketplace, governance) are built and hardened. The original
> phase-by-phase build plan and its decision log are archived under
> [`setup/archive/`](./setup/archive/) for historical reference.

---

## How it fits together

GitCade is one npm-workspaces monorepo (Node 22) split into three layers:

```
 packages/   the contract + the parts
   sdk/       @gitcade/sdk      — schema, entity-component runtime, storage
                                  bridge, and the `gitcade validate` CLI
   library/   @gitcade/library  — 60+ versioned, game-agnostic parts
                                  (behaviors, systems, entities, world, audio,
                                  UI, FX) + a machine-readable CATALOG.json

 games/      six seed games (Snake, Helicopter, Breakout, Tower Defense,
             Idle Clicker, Survival Arena) — each composed only from catalog
             parts + a per-game config.json, published to standalone GitHub repos

 platform/   the running system, three services sharing one Postgres + one
             S3/MinIO bucket:
   worker/           consumes a Postgres job queue, builds each game in an
                     ephemeral sibling Docker container, uploads the artifact
   artifact-server/  the ONLY path games reach the browser: streams artifacts
                     with a strict per-game CSP and immutable cache headers
   web/              the Next.js App Router site: publish, play, fork, remix,
                     marketplace, governance

 examples/   pong — the proof that a real game is buildable as pure JSON
 templates/  game-scaffold — the compliant starting point for a new game
 infra/      deployment topology (app vs. worker vs. storage trust zones)
 setup/      one-time machine setup, the human checklist, .env.example, and
             the archived build-plan docs
```

### The architecture in one paragraph

A game is data, not code: a `game.json` manifest, a flat `config.json` of every
tunable number, and JSON scene/entity definitions that reference parts by
`partId@version` and balance values by `$cfg.key`. The SDK's runtime turns that
JSON into a running Canvas game; the validator (`gitcade validate`) is the
publish gate — it rejects raw magic numbers, raw `localStorage`, and unresolved
part references. Games run in a `sandbox="allow-scripts"` iframe (opaque origin,
strongest isolation), so they can't touch browser storage directly: the SDK
ships a **postMessage storage bridge** that the platform page answers,
namespacing every save by `gameSlug + branch` so switching branches or playing a
fork never corrupts a save. Because balance lives in data, a community vote to
rebalance a game is a one-line JSON diff the platform can commit automatically.

---

## Quick start (local development)

One-time machine prep (Docker, Node 22 via nvm, local Postgres + MinIO,
Playwright Chromium, `gh` auth) is handled by
[`setup/setup-kali.sh`](./setup/setup-kali.sh). See
[`setup/CHECKLIST.md`](./setup/CHECKLIST.md) for the external accounts you must
create yourself (GitHub org + OAuth App + GitHub App, smee.io channel, npm
`@gitcade` scope). Then:

```bash
# 1. Install workspace deps
npm install

# 2. Configure — copy the template and fill the external-account blanks
cp setup/.env.example .env   # then edit .env

# 3. Build the packages and validate the proof game
npm run build
npm run validate:pong        # gitcade validate examples/pong
npm test                     # runs every workspace's test suite

# 4. Bring up the platform (each in its own terminal, all from platform/*)
cd platform/web            && npm run prisma:push && npm run dev   # :3000
cd platform/artifact-server && npm start                          # :3001
cd platform/worker          && npm run build:image && npm start    # queue consumer
```

Then open <http://localhost:3000>, sign in with GitHub, and use
`npm run seed` (in `platform/web`) to register the six seed games through the
real publish flow.

**Ports:** 3000 = web app, 3001 = artifact server, 5432 = Postgres,
9000/9001 = MinIO. All dev services bind to loopback.

---

## Configuration

All configuration is environment variables, documented key-by-key in
[`setup/.env.example`](./setup/.env.example). The groups:

| Group | Keys |
|---|---|
| GitHub | `GITHUB_ORG`, `GITHUB_OAUTH_ID`, `GITHUB_OAUTH_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET`, `WEBHOOK_PROXY_URL` |
| Database & storage | `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` |
| Artifact serving | `ARTIFACT_SERVER_PORT`, `ARTIFACT_BASE_URL` |
| Build worker | `BUILDER_IMAGE`, `QUEUE_POLL_INTERVAL_MS` |
| Platform auth | `NEXTAUTH_URL`, `NEXTAUTH_SECRET` |

`.env`, `*.pem`, and `setup/secrets/` are gitignored — never commit credentials.
`S3_FORCE_PATH_STYLE` is `true` for MinIO and `false` for real S3/R2; the S3
client honors it so the same code works against both.

---

## Documentation map

| Doc | What it owns |
|---|---|
| **[CLAUDE.md](./CLAUDE.md)** | The operating contract for working on this codebase — machine rules, frozen contracts, how to run and verify. |
| **[infra/README.md](./infra/README.md)** | Deployment topology: the app / worker / storage trust zones and the boundaries between them. |
| **[platform/README.md](./platform/README.md)** | The three platform services and how they share the queue, database, and bucket. |
| **[platform/SECURITY.md](./platform/SECURITY.md)** · **[platform/PERFORMANCE.md](./platform/PERFORMANCE.md)** | The Phase 8 hardening and performance audits. |
| **[packages/sdk/README.md](./packages/sdk/README.md)** · **[packages/library/README.md](./packages/library/README.md)** | Package-level API and authoring docs. |
| **[games/PUBLISHED.md](./games/PUBLISHED.md)** · **[games/LIBRARY-GAPS.md](./games/LIBRARY-GAPS.md)** | The published seed-game repos and the generalization candidates for a future library release. |
| **[setup/archive/](./setup/archive/)** | Historical: `MASTER-PLAN.md` (the original build plan + locked decisions), `DECISIONS.md`, `ENVIRONMENT.md`, `BLOCKED.md`. |

---

## License

Code MIT, assets CC-BY (enforced at upload). The locked product and licensing
decisions are recorded in [`setup/archive/MASTER-PLAN.md`](./setup/archive/MASTER-PLAN.md) §2.
