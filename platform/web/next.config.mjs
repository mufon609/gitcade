// GitCade web app config. The web app loads the SAME repo-root .env the worker
// and artifact-server use (DATABASE_URL, GitHub OAuth, S3/artifact base URL) so
// there is one source of truth for secrets — see src/lib/env.ts, which all
// server modules import. We also pre-load it here so Next's own build/runtime
// process.env is populated before any module evaluates.
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, "..", "..", ".env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @gitcade/sdk is an ESM workspace package consumed server-side (manifest
  // schema) and client-side (storage protocol). Transpile it so Next bundles it.
  transpilePackages: ["@gitcade/sdk"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
