// THE POLLING FALLBACK runner. The app-level webhook is primary; this covers what
// it can't reach: open-tier repos without the GitCade App installed, and webhook/
// tunnel downtime. It compares each tracked (game, branch)'s GitHub HEAD to the
// last commit we built and enqueues a rebuild on drift. Enqueue only — never build.
//
// Usage:
//   npx tsx scripts/poll-repos.ts            # one pass
//   npx tsx scripts/poll-repos.ts --watch    # loop every REPO_POLL_INTERVAL_MS (default 5m)
//
// A GitHub token is recommended (anonymous = 60 req/hr, exhausted fast). We read
// GITHUB_TOKEN, else fall back to `gh auth token` (gh is pre-authenticated).
import { execFileSync } from "node:child_process";
import { pollTrackedRepos } from "../src/lib/poll";

function resolveToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function onePass(token?: string): Promise<void> {
  const ts = new Date().toISOString();
  const s = await pollTrackedRepos({ token });
  const enq = s.enqueued.map((e) => `${e.slug}@${e.branch} ${(e.from ?? "∅").slice(0, 7)}→${e.to.slice(0, 7)}`);
  console.log(
    `[${ts}] polled ${s.checkedTargets} target(s): enqueued ${s.enqueued.length}` +
      (enq.length ? ` (${enq.join(", ")})` : "") +
      `, skipped ${s.skipped}, errors ${s.errors.length}`,
  );
  if (s.errors.length) {
    for (const e of s.errors) console.log(`   · ${e.slug}@${e.branch}: ${e.error}`);
  }
}

async function main(): Promise<void> {
  const token = resolveToken();
  if (!token) console.log("⚠ no GitHub token (anonymous 60 req/hr) — set GITHUB_TOKEN or `gh auth login`.");
  const watch = process.argv.includes("--watch");
  await onePass(token);
  if (!watch) return;
  const interval = Number(process.env.REPO_POLL_INTERVAL_MS ?? 300_000);
  console.log(`watching — re-polling every ${Math.round(interval / 1000)}s …`);
  setInterval(() => void onePass(token), interval);
}

void main();
