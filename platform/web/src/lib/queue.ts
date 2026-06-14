// The web app's enqueue path. This MIRRORS the frozen 4A enqueue contract
// (platform/worker/src/queue.ts) VERBATIM in shape and semantics — same
// EnqueueInput, same canonical slug derivation, same per-(game,branch) dedup —
// but runs against the web app's Prisma client.
//
// WHY a mirror and not a cross-package import: the worker is a tsx-run service
// whose modules use `./db.js`-style ESM specifiers and its own generated Prisma
// client; importing them into the Next bundler is fragile. The REAL interface
// between the two services is the shared Postgres `BuildJob` table, and the web
// app's Prisma client writes byte-identical rows to it. The worker is, and stays,
// the only thing that BUILDS — the web app only enqueues and reads. If the 4A
// enqueue contract ever changes, that is a CORE blocker (HALT), not a web edit.
import { prisma } from "./prisma";

/** Canonical game slug from a repo URL: basename minus ".git". (Verbatim from
 *  platform/worker/src/queue.ts so both sides derive identical slugs.) */
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
 *  redundant build — so rapid publishes/pushes coalesce. */
export async function enqueueBuild(
  input: EnqueueInput,
): Promise<{ id: string; deduped: boolean }> {
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
