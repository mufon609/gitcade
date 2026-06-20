# infra/ — Deployment Topology

How GitCade is deployed: three trust zones — **app**, **worker**, **storage** —
deliberately kept separate. This document is the topology contract derived from
the Locked Architecture Decisions (MASTER-PLAN.md §2). Local dev runs the same
shapes on one machine via Docker; see [ENVIRONMENT.md](../ENVIRONMENT.md) for
the concrete local endpoints.

## Why three zones

The single most important security property: **untrusted game code never runs on
the platform origin and never touches platform storage credentials.** Game
artifacts are served from a *separate origin* into a sandboxed iframe; builds run
in *isolated, network-restricted containers*; only the worker and artifact
server hold bucket credentials. Everything below follows from that.

## The diagram

```
                                 ┌───────────────────────────────────────┐
                                 │              GitHub                    │
                                 │  game repos · OAuth App · GitHub App   │
                                 │  (app-level push webhook)             │
                                 └───────────────────────────────────────┘
                                   ▲            │ push webhook │ clone (anon,
                          OAuth /  │            │ (smee.io     │ public repos)
                          fork /   │            ▼  locally)    ▼
                          remix    │   ┌──────────────────┐   ┌──────────────────┐
                          (user    │   │   APP ZONE       │   │  WORKER ZONE     │
                          token)   │   │                  │   │                  │
   ┌─────────┐  HTTPS            ┌─┴───┤ Next.js web app  │   │ Build worker     │
   │ Browser │ ───────────────► │ :3000 (App Router)     │   │ (long-running    │
   │         │                  │     │ Prisma · NextAuth │   │  Node, Docker)   │
   │ ┌─────┐ │  enqueue job ───►│     │                  ├──►│ polls queue,     │
   │ │game │ │  (DB row)        │     │ NEVER builds     │   │ spawns SIBLING   │
   │ │iframe│ │                 │     │ NEVER serves     │   │ builder          │
   │ └──┬──┘ │                  │     │ game artifacts   │   │ containers       │
   └────┼────┘                  │     └────────┬─────────┘   └───┬──────────┬───┘
        │  sandbox=             │              │                 │          │
        │  "allow-scripts"     │   read/write │   read/write    │ upload   │ build in
        │  (opaque origin)     │              ▼                 ▼ artifact │ --network none
        │  + strict CSP        │     ┌──────────────────────────────┐     │ (ephemeral
        │                      │     │      STORAGE ZONE            │     │  builder image:
        │  GET /artifacts/...  │     │                              │◄────┘  Node22+Chromium)
        │  (separate origin)   │     │  Postgres  ── app data       │
        ▼                      │     │            └─ build job queue │
   ┌──────────────────┐        │     │            (NO external queue)│
   │ Artifact server  │        │     │                              │
   │ :3001 / separate │ ───────┴────►│  S3 / R2 / MinIO ── artifacts│
   │ domain in prod   │  stream      │                              │
   │ sets CSP +       │  artifacts   └──────────────────────────────┘
   │ content-types +  │
   │ immutable cache  │  Browser loads the iframe directly from here —
   └──────────────────┘  a DIFFERENT origin than the app. Never presigned
                         URLs (break relative asset paths); never raw bucket
                         (can't set CSP).
```

## Zone responsibilities

### APP ZONE — the website
- **What:** Next.js App Router app (TypeScript, Tailwind, Prisma, NextAuth + GitHub OAuth).
- **Prod:** Vercel, or a container. Serverless is fine here — requests are short.
- **Local:** `localhost:3000`.
- **Holds:** the user's OAuth token (for forks/remix commits) and the GitHub App webhook secret (for verifying inbound push webhooks).
- **Never:** runs game builds; serves game artifacts. It only **enqueues** build jobs (writes a Postgres queue row) and **reads** Build rows.

### WORKER ZONE — the build pipeline
- **What:** a long-running Node service that polls the Postgres queue and turns `(repoUrl, branch, commit)` into a validated, stored artifact.
- **Prod:** Docker on a VPS / Fly.io / ECS — **never serverless** (builds are multi-minute and run untrusted code). This is *why* the worker is its own zone.
- **Local:** a Docker container on this machine.
- **Isolation:** each build runs in an **ephemeral sibling container** (the worker mounts the host Docker socket — *not* Docker-in-Docker) from a dedicated builder image (Node 22 + Chromium + build deps, ~1.5–2 GB). Two-stage flow: **Stage 1 with network** (clone + `npm install` the pinned `@gitcade/sdk`/`@gitcade/library` from npm) → **Stage 2 with `--network none`** (validate + build `/dist`), then the worker uploads the extracted artifact. Workspace destroyed after upload.
- **Companion — artifact server:** a small service (`platform/artifact-server/`, port 3001) that streams `/artifacts/{game}/{branch}/{path}` from the bucket with correct content-types, the strict game CSP, and immutable cache headers. It is the **only** sanctioned read path for artifacts.

### STORAGE ZONE — the durable state
- **Postgres:** all platform data **and** the build job queue (a Postgres table — there is no external queue service like SQS/Redis). Managed Postgres (Neon/Supabase/RDS) in prod; local Docker container in dev.
- **Object storage:** built game artifacts in S3-compatible storage (S3 / Cloudflare R2 in prod; MinIO in dev). The same env-configured client serves both — honor `S3_FORCE_PATH_STYLE` (`true` for MinIO, `false` for real S3).

## Trust boundaries (the load-bearing rules)

1. **Separate origins.** The app origin and the artifact origin are different domains in prod. Game iframes use `sandbox="allow-scripts"` only (opaque origin) — adding `allow-same-origin` on a shared artifact origin would let every untrusted game read every other game's saves.
2. **Storage bridge.** Because the iframe is opaque-origin, browser storage throws — games persist via the SDK's postMessage bridge to the parent page (namespaced by `gameSlug + branch`). Validated by source identity + a per-session nonce, never origin strings.
3. **Network-restricted builds.** Game build/validate runs with `--network none`; only the clone/install stage has network.
4. **One CI, not two.** The platform pipeline *is* the CI. No GitHub Actions on game repos.
5. **App-level webhook.** One GitHub App webhook (push events) covers every installed repo. No per-repo hooks, no `admin:repo_hook` scope ever. Locally, deliveries arrive via the smee.io proxy (`WEBHOOK_PROXY_URL`) plus a polling fallback.
6. **Public repos only (v1)**, enforced at publish time — so the worker clones anonymously and needs no GitHub token.

## Local vs. production

| Concern | Local (this dev box) | Production |
|---|---|---|
| App | `localhost:3000` | Vercel / container |
| Worker | Docker container, sibling builds | Docker on VPS / Fly / ECS |
| Artifact server | `localhost:3001` | separate domain/subdomain |
| Postgres | Docker `localhost:5432` | managed Postgres |
| Object storage | MinIO `localhost:9000` (`S3_FORCE_PATH_STYLE=true`) | S3 / R2 (`false`) + CDN |
| Webhooks | smee.io proxy + polling fallback | real endpoint |

All values come from `.env` (template: [`../setup/.env.example`](../setup/.env.example)).
Never invent values for external services — a missing external key is a
`[CRITICAL]` halt per [ENVIRONMENT.md](../ENVIRONMENT.md), not a thing to guess.
