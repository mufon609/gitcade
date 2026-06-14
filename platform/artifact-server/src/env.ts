// Artifact-server env. Shares the S3/MinIO config with the worker (same client
// must work for both backends via env). Loads the repo-root .env explicitly.
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(`[CRITICAL] Required env var ${key} is missing (see setup/.env.example).`);
  }
  return v;
}
const optional = (key: string, fallback: string) =>
  process.env[key] && process.env[key]!.trim() !== "" ? process.env[key]! : fallback;

export const env = {
  port: Number(optional("ARTIFACT_SERVER_PORT", "3001")),
  s3Endpoint: required("S3_ENDPOINT"),
  s3Bucket: required("S3_BUCKET"),
  s3AccessKeyId: required("S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  s3ForcePathStyle: optional("S3_FORCE_PATH_STYLE", "true") === "true",
  s3Region: optional("S3_REGION", "us-east-1"),
  // Origins allowed to FRAME games (the platform). The opaque-origin sandbox is
  // the real isolation; frame-ancestors stops other sites embedding artifacts.
  platformOrigin: optional("PLATFORM_ORIGIN", optional("NEXTAUTH_URL", "http://localhost:3000")),
};
