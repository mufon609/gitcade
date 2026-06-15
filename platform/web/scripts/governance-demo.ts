// PHASE 7 VERIFICATION DRIVER — drives the governance DoD end-to-end through the
// REAL service code paths (never mocked; same pattern as seed / fork-demo / remix-
// demo). A browser cannot script GitHub OAuth, so this server-side driver:
//   • seeds backdated community members (real User + CommunityMembership +
//     PlaySession rows) so there are voters older than 7 days — the live demo
//     accounts are <7 days old. This is the ONLY synthetic affordance.
//   • backdates a proposal's closesAt to simulate an elapsed voting window (real
//     proposals wait the real 1–14 day window; we can't in a demo).
// Everything else is the real thing: real votes, real eligibility checks, a REAL
// app-authored commit to gitcade-games/tower-defense, a REAL rebuild, and a REAL
// fork-with-patch under the gh-authenticated user.
//
// Run: npm run governance-demo
import { execSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { refreshGameStatus } from "../src/lib/publish";
import { parseRepoUrl, getRepoFile, getBranchHead } from "../src/lib/github";
import {
  createProposal,
  openProposal,
  castVote,
  finalizeProposal,
  approveAndCommit,
  vetoProposal,
  forkWithPatch,
  voterEligibility,
} from "../src/lib/governance-service";

const GAME = "tower-defense";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function hr(t: string) {
  console.log("\n" + "═".repeat(72) + "\n  " + t + "\n" + "═".repeat(72));
}

/** Create (idempotently) a backdated community member with a play session. */
async function ensureVoter(opts: {
  login: string;
  ageDays: number;
  member: boolean;
  played: boolean;
  gameId: string;
}): Promise<string> {
  const email = `${opts.login}@governance.demo`;
  const createdAt = new Date(Date.now() - opts.ageDays * 24 * 60 * 60 * 1000);
  const user = await prisma.user.upsert({
    where: { email },
    update: { createdAt },
    create: { email, name: opts.login, githubLogin: opts.login, createdAt },
  });
  if (opts.member) {
    await prisma.communityMembership.upsert({
      where: { userId_gameId: { userId: user.id, gameId: opts.gameId } },
      update: {},
      create: { userId: user.id, gameId: opts.gameId },
    });
  }
  if (opts.played) {
    const existing = await prisma.playSession.findFirst({ where: { userId: user.id, gameId: opts.gameId } });
    if (!existing) await prisma.playSession.create({ data: { userId: user.id, gameId: opts.gameId, durationSec: 60 } });
  }
  return user.id;
}

/** Poll the canonical game to LIVE after an enqueued rebuild. */
async function waitForLive(gameId: string, label: string, capMs = 180_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < capMs) {
    const s = await refreshGameStatus(gameId);
    if (s.state === "LIVE") {
      console.log(`  ${label}: LIVE ✓ (${Math.round((Date.now() - start) / 1000)}s)`);
      return true;
    }
    if (s.state === "FAILED") {
      console.log(`  ${label}: FAILED ✗\n${(s.logs ?? "").slice(0, 600)}`);
      return false;
    }
    await sleep(3000);
  }
  console.log(`  ${label}: timed out waiting for LIVE`);
  return false;
}

async function main() {
  const ghToken = execSync("gh auth token").toString().trim();

  const game = await prisma.game.findUnique({ where: { slug: GAME } });
  if (!game) throw new Error(`No game ${GAME}. Seed first.`);
  if (!game.installationId) throw new Error(`${GAME} has no installationId — run backfill-installations first.`);
  console.log(`Game ${GAME}: owner=${game.ownerId} installation=${game.installationId} repo=${game.repoUrl}`);
  const ref = parseRepoUrl(game.repoUrl)!;

  const mufon = await prisma.user.findFirst({ where: { githubLogin: "mufon609" } });
  if (!mufon) throw new Error("No mufon609 user — Phase 5/6 should have created it.");

  // ── Seed eligible voters + the ineligible foils ──
  hr("SETUP — backdated community voters (the only synthetic affordance)");
  const author = await ensureVoter({ login: "td-captain", ageDays: 40, member: true, played: true, gameId: game.id });
  const eligibleIds: string[] = [];
  for (let i = 0; i < 11; i++) {
    eligibleIds.push(await ensureVoter({ login: `td-voter-${i}`, ageDays: 30, member: true, played: true, gameId: game.id }));
  }
  const newbie = await ensureVoter({ login: "td-newbie", ageDays: 2, member: true, played: true, gameId: game.id });
  const lurker = await ensureVoter({ login: "td-lurker", ageDays: 30, member: false, played: true, gameId: game.id });
  const tourist = await ensureVoter({ login: "td-tourist", ageDays: 30, member: true, played: false, gameId: game.id });
  console.log(`  ${eligibleIds.length} eligible voters + author; 3 ineligible foils (newbie/lurker/tourist).`);

  // ════════════════════════════════════════════════════════════════════════
  // DEMO 1 — config-change → vote → PASS → APP AUTO-COMMIT → rebuild LIVE
  // ════════════════════════════════════════════════════════════════════════
  hr("DEMO 1 — config-change proposal → vote → pass → app auto-commit → rebuild");

  const beforeHead = await getBranchHead(ref, "main", ghToken);
  console.log(`  main HEAD before: ${beforeHead.sha?.slice(0, 8)}`);

  const created = await createProposal({
    gameSlug: GAME,
    authorId: author,
    type: "CONFIG_CHANGE",
    title: "Cheaper arrow towers (towerCost 50 → 40)",
    body: "Towers feel too expensive in the early waves; drop the cost a little.",
    edits: { configEdits: { towerCost: 40 } },
    windowDays: 5,
    quorum: 10,
    thresholdPct: 70,
    token: ghToken,
  });
  if (!created.ok) throw new Error(`createProposal failed: ${created.error} ${JSON.stringify(created.issues ?? [])}`);
  const p1 = created.proposal.id;
  console.log(`  draft created: ${p1} (status ${created.proposal.status})`);

  const opened = await openProposal(p1, author);
  console.log(`  opened for voting: status=${opened.proposal?.status} closesAt=${opened.proposal?.closesAt?.toISOString()}`);

  // ── ANTI-BRIGADING: the ineligible foils are blocked, with reasons ──
  hr("DEMO 1 — anti-brigading: ineligible voters are BLOCKED");
  for (const [label, id] of [
    ["newbie (account < 7 days)", newbie],
    ["lurker (not a member)", lurker],
    ["tourist (never played)", tourist],
  ] as [string, string][]) {
    const r = await castVote(p1, id, "YES");
    console.log(`  ${label}: ${r.ok ? "ALLOWED ✗ (BUG!)" : "blocked ✓ → " + (r.reasons ?? [r.error]).join("; ")}`);
  }

  // ── Eligible voters vote: 10 yes, 1 no = 90.9%, quorum 11 ≥ 10 ──
  hr("DEMO 1 — eligible voters cast votes");
  for (let i = 0; i < eligibleIds.length; i++) {
    const choice = i === eligibleIds.length - 1 ? "NO" : "YES"; // 10 yes / 1 no
    const r = await castVote(p1, eligibleIds[i], choice);
    if (!r.ok) console.log(`  voter ${i}: REJECTED ${JSON.stringify(r)}`);
  }
  const elig = await voterEligibility(eligibleIds[0], game.id);
  console.log(`  sample eligible voter check: eligible=${elig.eligible} signals=${JSON.stringify(elig.signals)}`);

  // ── Simulate the window elapsing, then finalize ──
  await prisma.proposal.update({ where: { id: p1 }, data: { closesAt: new Date(Date.now() - 1000) } });
  const finalized = await finalizeProposal(p1);
  console.log(`  finalized → status=${finalized?.status} (window backdated to simulate the 5-day close)`);
  if (finalized?.status !== "PASSED") throw new Error("Expected PASSED");

  // ── Owner approves → APP-AUTHORED auto-commit (NO human touches git) ──
  hr("DEMO 1 — owner approves → GitHub App installation auto-commit");
  const applied = await approveAndCommit(p1, game.ownerId);
  if (!applied.ok) throw new Error(`approveAndCommit failed: ${applied.error} ${JSON.stringify(applied.issues ?? [])}`);
  console.log(`  committed ${applied.commit.slice(0, 8)} via the governance app; rebuild job ${applied.jobId}`);

  // Verify the commit is REAL and AUTHORED BY THE APP (not a human).
  const commitMeta = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${applied.commit}`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "User-Agent": "gitcade" },
  }).then((r) => r.json());
  console.log(`  commit author: ${commitMeta.author?.login ?? "(none)"} / committer: ${commitMeta.committer?.login ?? "(none)"}`);
  console.log(`  commit message: ${String(commitMeta.commit?.message).split("\n")[0]}`);

  // Verify the rebuild went LIVE and the new config landed on main.
  await waitForLive(game.id, "tower-defense rebuild");
  const cfgAfter = await getRepoFile(ref, "config.json", "main", ghToken);
  const towerCostAfter = cfgAfter.ok ? JSON.parse(cfgAfter.content!).towerCost : "?";
  console.log(`  config.json on main now: towerCost = ${towerCostAfter} (was 50)`);

  // ════════════════════════════════════════════════════════════════════════
  // DEMO 2 — passed proposal VETOED → fork-with-patch in one click → playable
  // ════════════════════════════════════════════════════════════════════════
  hr("DEMO 2 — proposal → pass → owner VETO → fork-with-patch → playable");

  const c2 = await createProposal({
    gameSlug: GAME,
    authorId: author,
    type: "CONFIG_CHANGE",
    title: "More starting gold (startGold 220 → 300)",
    body: "Give players a stronger opening.",
    edits: { configEdits: { startGold: 300 } },
    token: ghToken,
  });
  if (!c2.ok) throw new Error(`createProposal#2 failed: ${c2.error}`);
  const p2 = c2.proposal.id;
  await openProposal(p2, author);
  for (let i = 0; i < eligibleIds.length; i++) await castVote(p2, eligibleIds[i], "YES"); // unanimous
  await prisma.proposal.update({ where: { id: p2 }, data: { closesAt: new Date(Date.now() - 1000) } });
  const f2 = await finalizeProposal(p2);
  console.log(`  proposal #2 finalized → ${f2?.status}`);

  const vetoed = await vetoProposal(p2, game.ownerId, "Too generous — it trivialises the first three waves.");
  console.log(`  owner VETOED → status=${vetoed.proposal?.status} reason="${vetoed.proposal?.vetoReason}"`);

  // The exit door: fork-with-patch as mufon609 (their OAuth token + their fork).
  hr("DEMO 2 — exit door: fork-with-patch (acts as the user, not the app)");
  const fork = await forkWithPatch(p2, mufon.id, ghToken, "mufon609");
  if (!fork.ok) throw new Error(`forkWithPatch failed: ${fork.error} ${JSON.stringify(fork.issues ?? [])}`);
  console.log(`  forked → ${fork.slug} (forked=${fork.forked}) patch commit ${fork.commit?.slice(0, 8)}`);
  console.log(`  applied: ${fork.summary.join("; ")}`);
  const forkGame = await prisma.game.findUnique({ where: { slug: fork.slug } });
  if (forkGame) {
    await waitForLive(forkGame.id, `${fork.slug} build`);
    const forkRef = parseRepoUrl(forkGame.repoUrl)!;
    const forkCfg = await getRepoFile(forkRef, "config.json", forkGame.branch, ghToken);
    console.log(`  fork config startGold = ${forkCfg.ok ? JSON.parse(forkCfg.content!).startGold : "?"} (vetoed change applied on the fork)`);
  }

  hr("DONE — Phase 7 DoD demos complete");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("DRIVER FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
