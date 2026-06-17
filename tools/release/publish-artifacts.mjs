#!/usr/bin/env node
// Build each game's static /dist and (re)publish it to the S3/MinIO bucket under
// the frozen `{slug}/{branch}/{path}` artifact key convention the artifact server
// serves from. Content-types match platform/worker/src/s3.ts byte-for-byte; cache
// and per-game CSP headers are applied by the artifact server on SERVE, so the
// upload only needs the right ContentType (exactly what the build worker does).
//
// Usage:
//   node tools/release/publish-artifacts.mjs [--only=snake] [--branch=main]
//                                            [--no-build] [--dry-run]
//
// Reads S3_* from the repo-root .env (MinIO locally; honors S3_FORCE_PATH_STYLE).

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, log, parseArgs, selectGames, run, loadEnv, makeS3, walk, contentTypeFor } from "./lib.mjs";

const args = parseArgs();
const games = selectGames(args.only);
const branch = args.branch;

const env = loadEnv();
for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
  if (!env[k]) {
    log.err(`missing ${k} in .env`);
    process.exit(1);
  }
}

const { PutObjectCommand, HeadBucketCommand, CreateBucketCommand } = await import("@aws-sdk/client-s3");
const s3 = await makeS3(env);
const bucket = env.S3_BUCKET;

if (!args.dryRun) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    log.note(`creating bucket ${bucket}`);
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

const results = [];
for (const slug of games) {
  log.banner(`${slug} → s3://${bucket}/${slug}/${branch}/`);
  const gameDir = path.join(REPO_ROOT, "games", slug);
  const distDir = path.join(gameDir, "dist");
  try {
    if (!args.noBuild) {
      log.note("npm run build…");
      run("npm", ["run", "build"], { cwd: gameDir });
    }
    if (!fs.existsSync(distDir)) throw new Error(`no dist at ${distDir} (drop --no-build to build it)`);

    const files = [...walk(distDir)];
    if (args.dryRun) {
      log.warn(`dry-run: would upload ${files.length} files under ${slug}/${branch}/`);
      results.push({ slug, status: "dry-run", count: files.length });
      continue;
    }
    let count = 0;
    for (const [abs, rel] of files) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${slug}/${branch}/${rel}`,
          Body: fs.readFileSync(abs),
          ContentType: contentTypeFor(abs),
        }),
      );
      count++;
    }
    log.ok(`uploaded ${count} files`);
    results.push({ slug, status: "published", count });
  } catch (err) {
    log.err(`${slug} FAILED: ${err.message.split("\n")[0]}`);
    results.push({ slug, status: "failed", error: err.message });
  }
}

log.banner("Summary");
for (const r of results) console.log(`  ${r.status === "failed" ? "✗" : "✓"} ${r.slug.padEnd(16)} ${r.status}${r.count != null ? ` (${r.count} files)` : ""}`);
if (results.some((r) => r.status === "failed")) process.exit(1);
