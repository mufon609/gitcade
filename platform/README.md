# platform/

The GitCade platform services. Built across Phases 4–8.

| Service | Path | Phase | Role |
|---|---|---|---|
| Build worker | `platform/worker/` | 4A | Long-running Node service; consumes the Postgres job queue, builds `(repo, branch, commit)` into validated artifacts in sibling containers, uploads to S3/MinIO. |
| Artifact server | `platform/artifact-server/` | 4A | Streams `/artifacts/{game}/{branch}/{path}` from the bucket with correct content-types, the strict game CSP, and immutable cache headers. Port 3001. **Never** presigned URLs or raw bucket exposure. |
| Web app | `platform/web/` | 4B+ | Next.js (App Router) + TypeScript + Tailwind + Prisma/Postgres + GitHub OAuth. Publish, play, fork, marketplace, governance. Enqueues build jobs and reads Build rows — it **never** builds anything itself. |

Deployment topology (app vs. worker vs. storage) is documented in
[`../infra/README.md`](../infra/README.md).

> Placeholder — service directories are created by their respective phases.
> See **MASTER-PLAN.md** for per-phase prompts and Definitions of Done.
