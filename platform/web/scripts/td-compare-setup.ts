// Set up the Tower Defense compare-play DoD: on the tower-defense fork, create TWO
// rebalanced branches (cheap towers vs expensive towers) by editing config.json,
// then enqueue a build for each so both are playable at their {slug}/{branch}
// artifact path. The /compare page then loads them side by side with a real
// config.json ConfigDiff. Uses the gh-authenticated user's token (same pattern as
// fork-demo) and the SHARED github helpers.
import { execFileSync } from "node:child_process";
import {
  parseRepoUrl,
  getBranchHead,
  getFileWithSha,
  putFile,
  createBranch,
} from "../src/lib/github";
import { enqueueBuild } from "../src/lib/queue";

const token = () => execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();

const FORK_SLUG = "tower-defense--mufon609";
const REPO = "https://github.com/mufon609/tower-defense.git";

// Two rebalances expressed as config.json overrides.
const VARIANTS: Array<{ branch: string; overrides: Record<string, number> }> = [
  { branch: "cheap-towers", overrides: { towerCost: 30, towerDamage: 30 } },
  { branch: "dear-towers", overrides: { towerCost: 90, towerDamage: 14, startGold: 300 } },
];

async function main(): Promise<void> {
  const t = token();
  const ref = parseRepoUrl(REPO)!;

  const head = await getBranchHead(ref, "main", t);
  if (!head.ok || !head.sha) throw new Error("could not read fork main HEAD: " + head.error);

  for (const v of VARIANTS) {
    // 1. branch off main
    const cb = await createBranch(ref, v.branch, head.sha, t);
    if (!cb.ok) throw new Error(`createBranch ${v.branch}: ${cb.error}`);

    // 2. edit config.json on that branch
    const file = await getFileWithSha(ref, "config.json", v.branch, t);
    if (!file.ok || !file.content) throw new Error(`read config.json@${v.branch}: ${file.error}`);
    const cfg = JSON.parse(file.content) as Record<string, number>;
    const changed: string[] = [];
    for (const [k, val] of Object.entries(v.overrides)) {
      changed.push(`${k}: ${cfg[k]} → ${val}`);
      cfg[k] = val;
    }
    const next = JSON.stringify(cfg, null, 2) + "\n";
    if (next.trim() !== file.content.trim()) {
      const put = await putFile(
        ref,
        "config.json",
        v.branch,
        next,
        `rebalance(${v.branch}): ${changed.join(", ")}`,
        t,
        file.sha,
      );
      if (!put.ok) throw new Error(`putFile ${v.branch}: ${put.error}`);
    }

    // 3. enqueue a build for the branch (worker uploads to {slug}/{branch})
    const job = await enqueueBuild({ repoUrl: REPO, branch: v.branch, gameSlug: FORK_SLUG });
    console.log(`✓ ${FORK_SLUG}@${v.branch}  [${changed.join(", ")}]  → job ${job.id}${job.deduped ? " (deduped)" : ""}`);
  }

  console.log(`\nCompare URL once both build:`);
  console.log(
    `  /compare?a=${FORK_SLUG}&ab=${VARIANTS[0].branch}&b=${FORK_SLUG}&bb=${VARIANTS[1].branch}`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗ " + (e as Error).message);
    process.exit(1);
  },
);
