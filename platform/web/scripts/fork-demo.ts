// REAL fork round-trip driver (Phase 5 DoD proof). A script cannot perform browser
// OAuth, so — exactly like the 4B seed script drives publishGame — this drives the
// SHARED forkGame service server-side: it ensures a User row for the gh-authenticated
// account, stores that account's `gh auth token` as the user's GitHub token, then
// forks a seed game through the real code path and reports the click→playable time.
//
// Usage: npx tsx scripts/fork-demo.ts <parent-slug>   (default: snake)
import { execFileSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { forkGame } from "../src/lib/fork";

function ghToken(): string {
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}
function ghLogin(): string {
  return execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" }).trim();
}

async function ensureUser(login: string, token: string): Promise<string> {
  const email = `${login}@users.noreply.github.com`;
  const user = await prisma.user.upsert({
    where: { email },
    update: { githubLogin: login },
    create: { email, name: login, githubLogin: login },
  });
  // Store the token on a github Account row so getUserGitHubToken(userId) finds it —
  // this is the same shape NextAuth's PrismaAdapter writes on browser login.
  await prisma.account.upsert({
    where: { provider_providerAccountId: { provider: "github", providerAccountId: login } },
    update: { access_token: token, userId: user.id },
    create: {
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId: login,
      access_token: token,
      scope: "read:user user:email public_repo",
    },
  });
  return user.id;
}

async function main(): Promise<void> {
  const parentSlug = process.argv[2] || "snake";
  const token = ghToken();
  const login = ghLogin();
  const userId = await ensureUser(login, token);
  console.log(`forking "${parentSlug}" as ${login} (user ${userId}) …`);

  const t0 = Date.now();
  const result = await forkGame({ parentSlug, userId, token, username: login });
  if (!result.ok) {
    console.error(`✗ fork failed at stage "${result.stage}": ${result.error}`);
    process.exit(1);
  }
  console.log(`✓ fork registered: ${result.slug}  (job ${result.jobId})`);
  console.log(
    `  timings: fork ${result.timings.forkMs}ms · ready ${result.timings.readyMs}ms · ` +
      `rewrite ${result.timings.rewriteMs}ms · TOTAL(click→enqueued) ${result.timings.totalMs}ms`,
  );
  console.log(`  (fork+enqueue done in ${Date.now() - t0}ms; the build worker now produces the artifact)`);
  console.log(`  watch: GET /api/games/${result.slug}/build-status  ·  play: /games/${result.slug}`);
  await prisma.$disconnect();
}

void main();
