// S3-compatible artifact storage. The SAME client must work for MinIO (local)
// and real S3/R2 — driven entirely by env. forcePathStyle is REQUIRED for MinIO
// (Locked Decision 5b).
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";

export const s3 = new S3Client({
  endpoint: env.s3Endpoint,
  region: env.s3Region,
  forcePathStyle: env.s3ForcePathStyle,
  credentials: {
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
  },
});

// Content types for everything a Vite static build emits. Kept in sync with the
// artifact server's map — both must agree so the served headers match.
const CONTENT_TYPES: Record<string, string> = {
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
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3Bucket }));
  }
}

/** Recursively walk a directory, yielding [absolutePath, posixRelativePath]. */
function* walk(dir: string, base = dir): Generator<[string, string]> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(abs, base);
    } else if (entry.isFile()) {
      yield [abs, path.relative(base, abs).split(path.sep).join("/")];
    }
  }
}

/** Upload a built /dist directory to the bucket under `{prefix}/...`, setting a
 *  correct content-type per file. Returns the number of files uploaded. */
export async function uploadDir(localDir: string, prefix: string): Promise<number> {
  let count = 0;
  for (const [abs, rel] of walk(localDir)) {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: `${prefix}/${rel}`,
        Body: fs.readFileSync(abs),
        ContentType: contentTypeFor(abs),
      }),
    );
    count++;
  }
  return count;
}

/** List object keys under a prefix (used by the proof to confirm artifacts). */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: env.s3Bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
