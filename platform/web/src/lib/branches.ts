// Branch enumeration for the branch switcher. A game's playable branches are the
// ones with a SUCCESSful Build (each served at the FROZEN artifact path
// {slug}/{branch}). Branches with a failing build are listed too — shown disabled
// with a link to their logs. We also surface repo branches that have never been
// built so the owner can kick off a build (enqueue, never build).
import { prisma } from "./prisma";
import { parseRepoUrl, listBranches } from "./github";

export type BranchBuildState = "LIVE" | "BUILDING" | "FAILED" | "UNBUILT";

export interface BranchEntry {
  name: string;
  state: BranchBuildState;
  /** Commit last built for this branch (if any). */
  commit?: string | null;
  /** True when an artifact exists and is servable (state === LIVE). */
  playable: boolean;
  /** Whether this is the game's primary tracked branch. */
  primary: boolean;
}

/** Reconcile one (slug, branch) to a build state using the JOB-is-the-gate rule
 *  (BuildJob.status === DONE before trusting Build.status — the worker writes a
 *  placeholder Build row up front; see refreshGameStatus). */
async function branchState(gameSlug: string, branch: string): Promise<{ state: BranchBuildState; commit: string | null }> {
  const job = await prisma.buildJob.findFirst({
    where: { gameSlug, branch },
    orderBy: { createdAt: "desc" },
    include: { build: true },
  });
  if (!job) return { state: "UNBUILT", commit: null };
  if (job.status !== "DONE" || !job.build) return { state: "BUILDING", commit: job.commit };
  return { state: job.build.status === "SUCCESS" ? "LIVE" : "FAILED", commit: job.build.commit };
}

/**
 * List a game's branches with their build state. `includeRepoBranches` adds repo
 * branches that have never been built (state UNBUILT) by querying GitHub — off by
 * default to keep the call DB-only and fast; the game page opts in.
 */
export async function listGameBranches(
  game: { slug: string; repoUrl: string; branch: string },
  opts: { includeRepoBranches?: boolean; token?: string } = {},
): Promise<BranchEntry[]> {
  // Branches we have build history for.
  const built = await prisma.build.findMany({
    where: { gameSlug: game.slug },
    distinct: ["branch"],
    select: { branch: true },
  });
  const names = new Set<string>([game.branch, ...built.map((b) => b.branch)]);

  if (opts.includeRepoBranches) {
    const ref = parseRepoUrl(game.repoUrl);
    if (ref) {
      try {
        for (const b of await listBranches(ref, opts.token)) names.add(b.name);
      } catch {
        /* GitHub optional here — DB branches still render */
      }
    }
  }

  const entries: BranchEntry[] = [];
  for (const name of names) {
    const { state, commit } = await branchState(game.slug, name);
    entries.push({ name, state, commit, playable: state === "LIVE", primary: name === game.branch });
  }
  // Primary first, then playable, then alphabetical.
  entries.sort(
    (a, b) =>
      Number(b.primary) - Number(a.primary) ||
      Number(b.playable) - Number(a.playable) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return entries;
}
