# @gitcade/worker — the build worker

Turns `(repoUrl, branch)` into a validated, stored, servable artifact. Consumes a
Postgres-backed queue table (Locked Decision: no external queue service) and runs
each build in **ephemeral sibling containers** launched from a dedicated builder
image — NOT Docker-in-Docker.

## Pipeline
```
clone (shallow, ANONYMOUS — public repos only) → npm install (pinned SDK/library
from public npm) → detect tier from game.json → tier validation → build /dist →
upload to S3/MinIO → write Build row
```
Two stages, two containers, one shared NAMED volume:
- **Stage 1 (network ON):** `git clone --depth 1` + `npm install`.
- **Stage 2 (`--network none`):** validation + `npm run build`.
  - **ecosystem:** full `npx gitcade validate .` (schema, no-magic-numbers,
    no-raw-storage, headless smoke) then build.
  - **open:** manifest+license checked worker-side (frozen SDK schema), then
    build + headless Chromium load check (no console errors).

The worker then exports `/dist` from the volume (`docker cp`), uploads each file
with a correct content-type, writes the `Build` row, and destroys the volume +
containers.

## CLI harness (how the worker is tested — no web app)
```bash
npm run cli -- build <repoUrl> [branch]   # enqueue + run ONE job end-to-end
npm run cli -- enqueue <repoUrl> [branch] # enqueue only (test the poller)
npm run cli -- start                      # long-running queue consumer (N-concurrent)
npm run cli -- list [n]                   # recent Build rows
```
`build` exits 0 on SUCCESS, 1 on FAILED, streaming verbatim logs.

## Setup
```bash
npm run build:image      # build the BUILDER image (Node 22 + Chromium), ~2 GB
npm run prisma:push      # create BuildJob + Build tables (uses platform/worker/.env)
```

## Two ways to run (same pipeline)
- **Host process:** the CLI above. Reaches Postgres/MinIO at
  `localhost` per the repo-root `.env`; launches siblings via the host Docker CLI.
- **Containerized (production topology):** `docker compose up --build`. Attaches to
  `gitcade-infra_default`, reaches `db:5432`/`minio:9000` by service name, mounts
  `/var/run/docker.sock` to launch siblings. The sibling-launch code is identical.

## Env (repo-root `.env`; `platform/worker/.env` holds `DATABASE_URL` for the Prisma CLI)
`DATABASE_URL`, `S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY`,
`S3_FORCE_PATH_STYLE`, `BUILDER_IMAGE`, `QUEUE_POLL_INTERVAL_MS`,
`WORKER_CONCURRENCY`, `BUILD_CPU_LIMIT`, `BUILD_MEMORY_LIMIT`, `BUILD_TIMEOUT_MS`,
`BUILD_NETWORK`.

## Handoff to the web app
The web app only **enqueues** (`enqueueBuild` in `src/queue.ts`) and **reads** Build
rows — it never builds. Contracts: the `BuildJob`/`Build` Prisma models,
per-(game,branch) dedup, and artifact paths `{slug}/{branch}` served at
`{ARTIFACT_BASE_URL}/artifacts/{slug}/{branch}/...`.
