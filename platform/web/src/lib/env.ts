// Centralized, server-only env access. The web app shares the repo-root .env with
// the worker + artifact-server (one source of truth for secrets, per
// ENVIRONMENT.md). We load it explicitly here — like the worker does — so server
// code never depends on Next's cwd-based .env discovery. A MISSING core key
// (DB / OAuth / artifact origin) is a [CRITICAL] condition: we throw loudly
// rather than invent a value for an external service.
//
// NOTE: intentionally NOT `import "server-only"` — this module is also imported
// by the standalone tsx seed script and by vitest, which run outside the Next
// bundler. Keep it free of client-only/server-only guards; it is server logic by
// placement and by the fact that it reads secrets.
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/lib -> platform/web -> platform -> repo root
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(
      `[CRITICAL] Required env var ${key} is missing. Set it in ${path.join(
        repoRoot,
        ".env",
      )} (see setup/.env.example). Never invent values for external services.`,
    );
  }
  return v;
}

const optional = (key: string, fallback: string): string => {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : fallback;
};

export const env = {
  repoRoot,
  databaseUrl: required("DATABASE_URL"),

  githubOrg: optional("GITHUB_ORG", "gitcade-games"),
  githubOAuthId: required("GITHUB_OAUTH_ID"),
  githubOAuthSecret: required("GITHUB_OAUTH_SECRET"),
  /// GitHub App slug/id — used to build the "Install the GitCade App" URL for the
  /// ecosystem governance step. App id is numeric; the install URL uses the app's
  /// public name, which we keep configurable.
  githubAppId: optional("GITHUB_APP_ID", ""),
  githubAppSlug: optional("GITHUB_APP_SLUG", "gitcade-governance"),
  /// The GitHub App private key — used ONLY to mint installation access tokens for
  /// governance auto-commits (Phase 7). Either inline (PEM, possibly with literal
  /// `\n`) or a path to the .pem file. NEVER the owner's OAuth token (locked
  /// Governance-credential decision).
  githubAppPrivateKey: optional("GITHUB_APP_PRIVATE_KEY", ""),
  githubAppPrivateKeyPath: optional("GITHUB_APP_PRIVATE_KEY_PATH", ""),

  nextAuthUrl: optional("NEXTAUTH_URL", "http://localhost:3000"),
  nextAuthSecret: required("NEXTAUTH_SECRET"),

  /// Shared secret for the GitHub App's app-level push webhook (Phase 5). The
  /// receiver verifies X-Hub-Signature-256 against this; an empty secret makes
  /// verification fail closed (every delivery rejected) rather than throwing app-wide.
  githubWebhookSecret: optional("GITHUB_WEBHOOK_SECRET", ""),
  /// The smee.io channel the App delivers to in local dev (forwarded to the webhook
  /// route by `npm run webhook:proxy`). Already set as the App's webhook URL in Phase 0.
  webhookProxyUrl: optional("WEBHOOK_PROXY_URL", ""),

  /// The artifact origin the iframe loads games from (opaque-origin sandbox). The
  /// 4A artifact server owns it (port 3001 locally / separate domain in prod).
  artifactBaseUrl: optional("ARTIFACT_BASE_URL", "http://localhost:3001"),

  /// The 4A builder image (Node 22 + Chromium + build deps). Phase 6 part uploads
  /// run schema validation + the part's unit test inside an ephemeral SIBLING
  /// container built from this image — the SAME isolated builder path the worker
  /// uses, never the web process. (We do NOT modify the frozen worker; we reuse its
  /// image + the docker-sibling pattern.)
  builderImage: optional("BUILDER_IMAGE", "gitcade-builder:local"),
  /// Network for the part-sandbox install stage (empty = default bridge w/ internet,
  /// like the worker's stage 1); the test stage always runs with --network none.
  sandboxNetwork: optional("BUILD_NETWORK", ""),
  sandboxCpuLimit: optional("BUILD_CPU_LIMIT", "2"),
  sandboxMemoryLimit: optional("BUILD_MEMORY_LIMIT", "2g"),
  sandboxTimeoutMs: Number(optional("PART_SANDBOX_TIMEOUT_MS", "300000")),

  /// The designated seed/admin user the seed script publishes the six games as.
  seedUserLogin: optional("SEED_USER_LOGIN", "gitcade-admin"),
  seedUserEmail: optional("SEED_USER_EMAIL", "admin@gitcade.local"),
};

export type Env = typeof env;
