// The build pipeline: turn one BuildJob into a validated, stored, servable
// artifact (or a readable rejection). Each build runs in TWO ephemeral sibling
// containers sharing a NAMED volume:
//   Stage 1 (network ON):  anonymous shallow clone + npm install.
//   Stage 2 (network none): tier-appropriate validation + static build.
// The worker then exports /dist from the volume, uploads it to S3/MinIO, writes
// the Build row, and destroys the workspace volume + containers.
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { GameManifestSchema } from "@gitcade/sdk";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { BuildLog } from "./logger.js";
import {
  createVolume,
  removeVolume,
  readFromVolume,
  copyFromVolume,
  dockerStream,
  listBuildContainers,
  imageExists,
} from "./docker.js";
import { ensureBucket, uploadDir } from "./s3.js";

const WORKER_ID = `${os.hostname()}:${process.pid}`;

export interface ProcessResult {
  buildId: string;
  status: "SUCCESS" | "FAILED";
  stage: string;
  artifactPath: string | null;
  fileCount: number | null;
  tier: string | null;
  commit: string | null;
}

interface JobInput {
  id: string;
  gameSlug: string;
  repoUrl: string;
  branch: string;
  commit: string | null;
}

/** Common docker-run args (resource + time limits, job label for cleanup proof). */
function baseRunArgs(jobId: string, volume: string, name: string): string[] {
  return [
    "run", "--rm", "--name", name,
    "-v", `${volume}:/workspace`,
    "--cpus", env.buildCpuLimit,
    "--memory", env.buildMemoryLimit,
    "--label", `gitcade-build=${jobId}`,
  ];
}

export async function processJob(job: JobInput, opts: { echo?: boolean } = {}): Promise<ProcessResult> {
  const log = new BuildLog({ echo: opts.echo ?? true });
  const volume = `gitcade-ws-${job.id}`;
  const exportDir = path.join(os.tmpdir(), `gitcade-export-${job.id}`);

  // Create the Build row up front so a row always exists, even on infra failure.
  const build = await prisma.build.create({
    data: {
      jobId: job.id,
      gameSlug: job.gameSlug,
      repoUrl: job.repoUrl,
      branch: job.branch,
      commit: job.commit,
      status: "FAILED",
      stage: "queued",
      logs: "",
    },
  });

  let stage = "init";
  let tier: string | null = null;
  let commit: string | null = job.commit;
  let artifactPath: string | null = null;
  let fileCount: number | null = null;

  const finalize = async (status: "SUCCESS" | "FAILED"): Promise<ProcessResult> => {
    // Best-effort workspace teardown — the named volume must not outlive the build.
    removeVolume(volume);
    fs.rmSync(exportDir, { recursive: true, force: true });
    const leftover = listBuildContainers(job.id);
    if (leftover.length) {
      log.note(`WARNING: build containers not cleaned up: ${leftover.join(", ")}`);
    } else {
      log.note("workspace volume + sibling containers destroyed");
    }
    await prisma.build.update({
      where: { id: build.id },
      data: { status, stage, logs: log.toString(), tier, commit, artifactPath, fileCount, finishedAt: new Date() },
    });
    await prisma.buildJob.update({
      where: { id: job.id },
      data: { status: "DONE", startedAt: undefined },
    });
    return { buildId: build.id, status, stage, artifactPath, fileCount, tier, commit };
  };

  try {
    log.banner(`BUILD ${job.gameSlug} @ ${job.branch}  (job ${job.id})`);
    log.note(`repo: ${job.repoUrl}`);
    log.note(`worker: ${WORKER_ID}  builder image: ${env.builderImage}`);

    if (!imageExists(env.builderImage)) {
      // Builder image is part of the build pipeline → core. Fail loudly + readably.
      stage = "image";
      log.note(`ERROR: builder image '${env.builderImage}' not found. Build it with: npm run build:image`);
      return await finalize("FAILED");
    }

    createVolume(volume);

    // ---- STAGE 1: clone + install (WITH NETWORK) ----
    stage = "clone+install";
    log.banner("STAGE 1 — clone + install (network ON)");
    const stage1Args = [
      ...baseRunArgs(job.id, volume, `gitcade-s1-${job.id}`),
      ...(env.buildNetwork ? ["--network", env.buildNetwork] : []),
      env.builderImage,
      "stage1.sh", job.repoUrl, job.branch,
    ];
    const s1 = await dockerStream(stage1Args, log, {
      timeoutMs: env.buildTimeoutMs,
      containerName: `gitcade-s1-${job.id}`,
    });
    if (s1 !== 0) {
      log.note(`STAGE 1 failed (exit ${s1}). See the clone/install output above.`);
      return await finalize("FAILED");
    }

    // ---- read commit + manifest from the volume ----
    try {
      commit = readFromVolume(volume, env.builderImage, "/workspace/commit.txt").trim() || commit;
    } catch {
      /* commit is best-effort */
    }

    // ---- MANIFEST + TIER (worker-side, using the frozen SDK schema) ----
    stage = "manifest";
    log.banner("MANIFEST — parse game.json, detect tier (validates manifest + license)");
    let manifestRaw: string;
    try {
      manifestRaw = readFromVolume(volume, env.builderImage, "/workspace/repo/game.json");
    } catch {
      log.note("ERROR: game.json not found at the repo root. Every GitCade game needs a game.json manifest.");
      return await finalize("FAILED");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestRaw);
    } catch (e) {
      log.note(`ERROR: game.json is not valid JSON: ${(e as Error).message}`);
      return await finalize("FAILED");
    }
    const result = GameManifestSchema.safeParse(parsed);
    if (!result.success) {
      log.note("ERROR: game.json failed manifest validation:");
      for (const issue of result.error.issues) {
        log.note(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      }
      return await finalize("FAILED");
    }
    const manifest = result.data;
    tier = manifest.tier;
    // The manifest slug is canonical for the artifact path (reconciled here).
    const slug = manifest.slug;
    log.note(`tier=${tier}  slug=${slug}  sdkVersion=${manifest.sdkVersion}  libraryVersion=${manifest.libraryVersion ?? "(n/a)"}`);

    // ---- STAGE 2: validate + build (NETWORK NONE) ----
    stage = tier === "ecosystem" ? "validate+build" : "build+headless";
    log.banner(`STAGE 2 — ${tier} validation + build (network NONE)`);
    const stage2Args = [
      ...baseRunArgs(job.id, volume, `gitcade-s2-${job.id}`),
      "--network", "none",
      env.builderImage,
      "stage2.sh", tier,
    ];
    const s2 = await dockerStream(stage2Args, log, {
      timeoutMs: env.buildTimeoutMs,
      containerName: `gitcade-s2-${job.id}`,
    });
    if (s2 !== 0) {
      log.note(`STAGE 2 failed (exit ${s2}). The ${tier} validation/build output above explains why.`);
      return await finalize("FAILED");
    }

    // ---- EXPORT + UPLOAD ----
    stage = "upload";
    log.banner("UPLOAD — export /dist from the workspace volume → S3/MinIO");
    fs.mkdirSync(exportDir, { recursive: true });
    copyFromVolume(volume, env.builderImage, "/workspace/repo/dist", exportDir);
    await ensureBucket();
    artifactPath = `${slug}/${job.branch}`;
    fileCount = await uploadDir(exportDir, artifactPath);
    log.note(`uploaded ${fileCount} files to s3://${env.s3Bucket}/${artifactPath}/`);
    log.note(`servable at ${process.env.ARTIFACT_BASE_URL || "http://localhost:3001"}/artifacts/${artifactPath}/index.html`);

    stage = "done";
    log.banner(`SUCCESS — ${slug} @ ${job.branch} built and stored`);
    return await finalize("SUCCESS");
  } catch (err) {
    log.note(`UNEXPECTED ERROR during '${stage}': ${(err as Error).stack || err}`);
    return await finalize("FAILED");
  }
}
