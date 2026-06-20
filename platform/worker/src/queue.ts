// The build queue is a Postgres table (Locked Decision: no external queue
// service). This module owns enqueue (with per-(game,branch) dedup) and atomic
// claiming (FOR UPDATE SKIP LOCKED) so N workers can process concurrently
// without double-claiming. The web app enqueues through `enqueueBuild` too — it
// never builds, only enqueues + reads Build rows.
import os from "node:os";
import { prisma } from "./db.js";

const WORKER_ID = `${os.hostname()}:${process.pid}`;

/** Canonical game slug from a repo URL: basename minus ".git". */
export function slugFromRepoUrl(repoUrl: string): string {
  const cleaned = repoUrl.replace(/\.git$/, "").replace(/\/+$/, "");
  const base = cleaned.split("/").pop() || cleaned;
  return base.toLowerCase();
}

export interface EnqueueInput {
  repoUrl: string;
  branch?: string;
  commit?: string | null;
  gameSlug?: string;
}

/** Enqueue a build. Per-(game,branch) DEDUP: if an active (PENDING/RUNNING) job
 *  already exists for the same game+branch, return it instead of stacking a
 *  redundant build — so rapid pushes coalesce. */
export async function enqueueBuild(input: EnqueueInput): Promise<{ id: string; deduped: boolean }> {
  const branch = input.branch || "main";
  const gameSlug = input.gameSlug || slugFromRepoUrl(input.repoUrl);

  const existing = await prisma.buildJob.findFirst({
    where: { gameSlug, branch, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { id: existing.id, deduped: true };

  const job = await prisma.buildJob.create({
    data: { gameSlug, repoUrl: input.repoUrl, branch, commit: input.commit ?? null },
  });
  return { id: job.id, deduped: false };
}

/** Atomically claim up to `limit` PENDING jobs for this worker. Uses row locks
 *  with SKIP LOCKED so concurrent workers never grab the same job. */
export async function claimJobs(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "BuildJob"
      WHERE status = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await tx.buildJob.updateMany({
        where: { id: { in: ids } },
        data: { status: "RUNNING", claimedBy: WORKER_ID, startedAt: new Date(), attempts: { increment: 1 } },
      });
    }
    return ids;
  });
}

export async function getJob(id: string) {
  return prisma.buildJob.findUnique({ where: { id } });
}
