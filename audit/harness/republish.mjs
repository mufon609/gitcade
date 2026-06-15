/**
 * Republish a built game's /dist to MinIO under `<slug>/main/`, the same key layout
 * the build worker (platform/worker/src/s3.ts) + artifact server use. Direct S3
 * upload — NO server. Clears the stale `<slug>/main/` prefix first, then uploads the
 * fresh dist, honoring S3_FORCE_PATH_STYLE (REQUIRED for MinIO). Reads creds from the
 * repo-root .env exactly like the worker's env loader.
 *
 * Usage: node audit/harness/republish.mjs <slug> [<slug> ...]
 */
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

function required(key) {
  const v = process.env[key];
  if (!v || v.trim() === "") throw new Error(`[CRITICAL] missing env ${key}`);
  return v;
}

const BUCKET = required("S3_BUCKET");
const s3 = new S3Client({
  endpoint: required("S3_ENDPOINT"),
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true") === "true",
  credentials: {
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
});

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const contentTypeFor = (f) => CONTENT_TYPES[path.extname(f).toLowerCase()] || "application/octet-stream";

function* walk(dir, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(abs, base);
    else if (e.isFile()) yield [abs, path.relative(base, abs).split(path.sep).join("/")];
  }
}

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
}

async function listKeys(prefix) {
  const keys = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function republish(slug) {
  const prefix = `${slug}/main`;
  const distDir = path.resolve(repoRoot, "games", slug, "dist");
  if (!fs.existsSync(distDir)) throw new Error(`no dist for ${slug} — build it first`);

  // Clear the stale prefix.
  const stale = await listKeys(prefix + "/");
  if (stale.length) {
    for (let i = 0; i < stale.length; i += 1000) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: stale.slice(i, i + 1000).map((Key) => ({ Key })) },
        }),
      );
    }
  }

  // Upload fresh dist.
  let uploaded = 0;
  for (const [abs, rel] of walk(distDir)) {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${prefix}/${rel}`,
        Body: fs.readFileSync(abs),
        ContentType: contentTypeFor(abs),
      }),
    );
    uploaded++;
  }
  const objectsNow = (await listKeys(prefix + "/")).length;
  return { slug, deletedStale: stale.length, uploaded, objectsNow };
}

const slugs = process.argv.slice(2);
if (slugs.length === 0) {
  console.error("usage: node republish.mjs <slug> [<slug> ...]");
  process.exit(2);
}
await ensureBucket();
for (const slug of slugs) {
  const r = await republish(slug);
  console.log(JSON.stringify(r));
}
