// THE POLLING FALLBACK for the app-level webhook. Webhooks cannot reach localhost
// and only cover repos the GitCade App is installed on; this fallback covers the
// gaps the Locked Decision names explicitly: OPEN-tier repos where the app isn't
// installed, and tunnel/webhook downtime. It checks each tracked repo's branch
// HEAD against the last commit we built and enqueues a rebuild when they differ.
//
// It is the same "enqueue, never build" contract as everything else. The decision
// (`shouldRebuild`) is pure so it unit-tests; `pollTrackedRepos` wires it to the DB
// + GitHub. Designed to run from a cron/loop (scripts/poll-repos.ts).
import { prisma } from "./prisma";
import { enqueueBuild } from "./queue";
import { parseRepoUrl, getBranchHead } from "./github";

/** Rebuild iff GitHub's head is known and differs from what we last built. A null
 *  lastBuilt (never built) DOES trigger a build; an unknown head (GitHub error)
 *  does NOT. */
export function shouldRebuild(headSha: string | null | undefined, lastBuiltCommit: string | null | undefined): boolean {
  if (!headSha) return false;
  return headSha !== (lastBuiltCommit ?? null);
}

export interface PollSummary {
  checkedTargets: number;
  enqueued: Array<{ slug: string; branch: string; from: string | null; to: string }>;
  skipped: number;
  errors: Array<{ slug: string; branch: string; error: string }>;
}

/**
 * Poll every tracked (game, branch) pair and enqueue rebuilds for branches whose
 * GitHub HEAD has moved past the last built commit. "Tracked branches" = the
 * game's own branch plus every branch that already has a Build row (those are the
 * branches the platform serves). `token` is optional but recommended — anonymous
 * GitHub is 60 req/hr, which a multi-game poll exhausts quickly.
 */
export async function pollTrackedRepos(opts: { token?: string } = {}): Promise<PollSummary> {
  const summary: PollSummary = { checkedTargets: 0, enqueued: [], skipped: 0, errors: [] };
  const games = await prisma.game.findMany({
    select: { id: true, slug: true, repoUrl: true, branch: true },
  });

  for (const game of games) {
    const ref = parseRepoUrl(game.repoUrl);
    if (!ref) {
      summary.errors.push({ slug: game.slug, branch: "*", error: `unparseable repoUrl ${game.repoUrl}` });
      continue;
    }

    // Tracked branches: the game's branch ∪ branches with Build rows.
    const builtBranches = await prisma.build.findMany({
      where: { gameSlug: game.slug },
      distinct: ["branch"],
      select: { branch: true },
    });
    const branches = new Set<string>([game.branch, ...builtBranches.map((b) => b.branch)]);

    for (const branch of branches) {
      summary.checkedTargets++;
      const head = await getBranchHead(ref, branch, opts.token);
      if (!head.ok || !head.sha) {
        // A branch in our Build history may have been deleted upstream — not fatal.
        summary.errors.push({ slug: game.slug, branch, error: head.error ?? "no head" });
        continue;
      }

      // Last commit we built for this (game, branch) — most recent Build row.
      const lastBuild = await prisma.build.findFirst({
        where: { gameSlug: game.slug, branch },
        orderBy: { createdAt: "desc" },
        select: { commit: true },
      });
      // An already-active job means a rebuild is in flight; enqueueBuild dedups
      // anyway, but skip the GitHub-vs-DB compare noise.
      const active = await prisma.buildJob.findFirst({
        where: { gameSlug: game.slug, branch, status: { in: ["PENDING", "RUNNING"] } },
        select: { id: true },
      });

      if (active) {
        summary.skipped++;
        continue;
      }
      if (!shouldRebuild(head.sha, lastBuild?.commit ?? null)) {
        summary.skipped++;
        continue;
      }

      const job = await enqueueBuild({
        repoUrl: game.repoUrl,
        branch,
        commit: head.sha,
        gameSlug: game.slug,
      });
      if (!job.deduped) {
        summary.enqueued.push({ slug: game.slug, branch, from: lastBuild?.commit ?? null, to: head.sha });
      } else {
        summary.skipped++;
      }
    }
  }
  return summary;
}
