// Centralized env access. The populated .env lives at the repo root (gitignored,
// per setup/archive/ENVIRONMENT.md); we load it explicitly since the worker runs from
// platform/worker. Local Postgres/MinIO defaults may be used freely; a MISSING
// key for DB/storage is a [CRITICAL] condition (we throw loudly rather than
// invent a value).
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    // Core-path env (DB/storage) missing → fail loudly, never mock.
    throw new Error(
      `[CRITICAL] Required env var ${key} is missing. Set it in ${path.join(repoRoot, ".env")} (see setup/.env.example). Never invent values for external services.`,
    );
  }
  return v;
}

function optional(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : fallback;
}

export const env = {
  repoRoot,
  databaseUrl: required("DATABASE_URL"),

  // S3 / MinIO — the SAME client must work for both via these vars.
  s3Endpoint: required("S3_ENDPOINT"),
  s3Bucket: required("S3_BUCKET"),
  s3AccessKeyId: required("S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  // Path-style is REQUIRED for MinIO, false for real S3 (Locked Decision 5b).
  s3ForcePathStyle: optional("S3_FORCE_PATH_STYLE", "true") === "true",
  s3Region: optional("S3_REGION", "us-east-1"),

  // Builder image the worker launches sibling containers from.
  builderImage: optional("BUILDER_IMAGE", "gitcade-builder:local"),

  // Queue polling + concurrency.
  queuePollIntervalMs: Number(optional("QUEUE_POLL_INTERVAL_MS", "2000")),
  concurrency: Math.max(1, Number(optional("WORKER_CONCURRENCY", "2"))),

  // Per-build resource + time limits (passed to `docker run`).
  buildCpuLimit: optional("BUILD_CPU_LIMIT", "2"),
  buildMemoryLimit: optional("BUILD_MEMORY_LIMIT", "2g"),
  buildTimeoutMs: Number(optional("BUILD_TIMEOUT_MS", "600000")),

  // Network the worker attaches sibling STAGE-1 containers to. Stage-1 needs
  // internet (clone + npm). On a host-run worker the default bridge has
  // internet, so we leave this empty. Set to "gitcade-infra_default" only if a
  // build ever needs to reach db/minio (it does not — only the worker does).
  buildNetwork: optional("BUILD_NETWORK", ""),
};

export type Env = typeof env;
