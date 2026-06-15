// THE GOVERNANCE SERVICE — the proposal lifecycle, shared by the API routes and the
// verification driver (never mocked, same pattern as publish/fork/remix).
//
// A Proposal belongs to a game and has a TYPE that determines how it becomes code:
//   • CONFIG_CHANGE / PART_SWAP — the proposal IS a diff (RemixEdits). On PASS +
//     owner approval the platform commits it to main via the GitHub APP INSTALLATION
//     (lib/github-app — NEVER the owner's OAuth token, locked decision) and rebuilds.
//     The SAME validateRemix gate that guards remix runs before the commit, so a
//     passed proposal can never land an invalid game on main.
//   • FEATURE_REQUEST — free text. On PASS it becomes a "help wanted" item; a PR
//     linking the proposal closes it. It NEVER auto-applies.
//
// Voting + tally are the trust-critical math in governance-tally + governance-
// eligibility (both pure + unit-tested); this module wires them to the DB/clock.
import { Prisma, type Proposal, type ProposalType } from "@prisma/client";
import { prisma } from "./prisma";
import { enqueueBuild } from "./queue";
import { parseRepoUrl, commitFiles } from "./github";
import { getInstallationToken } from "./github-app";
import { loadRemixSources, ensureRemixableFork, commitRemix } from "./remix-service";
import { getRemixCatalog, applyRemix, type RemixEdits } from "./remix";
import { validateRemix } from "./remix-validate";
import { diffConfigs } from "./configdiff";
import {
  tally,
  windowState,
  computeClosesAt,
  decideOutcome,
  type TallyResult,
} from "./governance-tally";
import { checkEligibility, accountAgeDays, type EligibilityResult } from "./governance-eligibility";

const AUTO_APPLICABLE: ProposalType[] = ["CONFIG_CHANGE", "PART_SWAP"];
export function isAutoApplicable(type: ProposalType): boolean {
  return AUTO_APPLICABLE.includes(type);
}

// ─────────────────────────── eligibility (DB signals → pure rule) ───────────────────────────

/** Gather the anti-brigading signals for (user, game) and run the pure rule. */
export async function voterEligibility(
  userId: string,
  gameId: string,
  now: number = Date.now(),
): Promise<EligibilityResult & { signals: { isMember: boolean; accountAgeDays: number; hasPlaySession: boolean; hasPriorContribution: boolean } }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  const [membership, playSession, priorProposals, ownedFork] = await Promise.all([
    prisma.communityMembership.findUnique({ where: { userId_gameId: { userId, gameId } } }),
    prisma.playSession.findFirst({ where: { userId, gameId }, select: { id: true } }),
    prisma.proposal.count({ where: { gameId, authorId: userId } }),
    prisma.game.findFirst({ where: { parentGameId: gameId, ownerId: userId }, select: { id: true } }),
  ]);
  const signals = {
    isMember: !!membership,
    accountAgeDays: user ? accountAgeDays(user.createdAt, now) : 0,
    hasPlaySession: !!playSession,
    hasPriorContribution: priorProposals > 0 || !!ownedFork,
  };
  return { ...checkEligibility(signals), signals };
}

// ─────────────────────────── tally helpers ───────────────────────────

export async function countVotes(proposalId: string): Promise<{ yes: number; no: number }> {
  const [yes, no] = await Promise.all([
    prisma.vote.count({ where: { proposalId, choice: "YES" } }),
    prisma.vote.count({ where: { proposalId, choice: "NO" } }),
  ]);
  return { yes, no };
}

export async function proposalTally(p: Pick<Proposal, "id" | "thresholdPct" | "quorum">): Promise<TallyResult> {
  const counts = await countVotes(p.id);
  return tally(counts, { thresholdPct: p.thresholdPct, quorum: p.quorum });
}

// ─────────────────────────── notifications ───────────────────────────

type NType = "PROPOSAL_OPENED" | "PROPOSAL_PASSED" | "PROPOSAL_FAILED" | "PROPOSAL_VETOED" | "PROPOSAL_APPLIED";

/** Fan a notification out to every community member of a game (in-app only, v1). */
async function notifyMembers(
  gameId: string,
  gameSlug: string,
  proposalId: string,
  type: NType,
  message: string,
): Promise<number> {
  const members = await prisma.communityMembership.findMany({ where: { gameId }, select: { userId: true } });
  if (members.length === 0) return 0;
  await prisma.notification.createMany({
    data: members.map((m) => ({ userId: m.userId, type, message, gameId, gameSlug, proposalId })),
  });
  return members.length;
}

// ─────────────────────────── create / open ───────────────────────────

export interface CreateProposalInput {
  gameSlug: string;
  authorId: string;
  type: ProposalType;
  title: string;
  body?: string;
  /** CONFIG_CHANGE / PART_SWAP only: the RemixEdits the proposal applies. */
  edits?: RemixEdits;
  windowDays?: number;
  quorum?: number;
  thresholdPct?: number;
  /** GitHub token to read repo sources (optional — public repos read anonymously). */
  token?: string;
}

export type CreateResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; error: string; issues?: { code: string; message: string; where?: string }[] };

/** Create a DRAFT proposal. For auto-applicable types the edit is materialised now
 *  (so the page can render a stable ConfigDiff) AND validated — a proposal that would
 *  produce an invalid game is refused at draft time, never voted on. */
export async function createProposal(input: CreateProposalInput): Promise<CreateResult> {
  const game = await prisma.game.findUnique({ where: { slug: input.gameSlug } });
  if (!game) return { ok: false, error: `No game with slug "${input.gameSlug}".` };
  // Governance is per-game and requires the App installed (auto-commit credential).
  if (!game.installationId) {
    return { ok: false, error: "Governance is not enabled for this game (the GitCade App is not installed on its repo)." };
  }
  if (!input.title.trim()) return { ok: false, error: "A title is required." };

  const base: Prisma.ProposalCreateInput = {
    game: { connect: { id: game.id } },
    author: { connect: { id: input.authorId } },
    type: input.type,
    status: "DRAFT",
    title: input.title.trim(),
    body: input.body?.trim() || null,
    windowDays: input.windowDays ?? 5,
    quorum: input.quorum ?? 10,
    thresholdPct: input.thresholdPct ?? 70,
  };

  if (isAutoApplicable(input.type)) {
    if (!input.edits) return { ok: false, error: "An auto-applicable proposal must carry edits." };
    const sources = await loadRemixSources(game, input.token);
    const catalog = await getRemixCatalog();
    const applied = applyRemix(sources.scene, sources.config, input.edits, catalog);
    if (applied.summary.length === 0) return { ok: false, error: "These edits change nothing." };
    // THE GATE (mirrors the worker + remix): refuse an invalid proposal at draft time.
    const issues = validateRemix(applied.scene, applied.config);
    if (issues.length > 0) return { ok: false, error: "This proposal would produce an invalid game.", issues };

    base.edits = input.edits as unknown as Prisma.InputJsonValue;
    base.baseConfig = sources.config as Prisma.InputJsonValue;
    base.headConfig = applied.config as unknown as Prisma.InputJsonValue;
    base.changeSummary = applied.summary;
  } else {
    // FEATURE_REQUEST: free text is the proposal.
    if (!input.body?.trim()) return { ok: false, error: "A feature request needs a description / acceptance criteria." };
  }

  const proposal = await prisma.proposal.create({ data: base });
  return { ok: true, proposal };
}

/** Open a DRAFT proposal for voting: stamp openedAt + closesAt and notify members. */
export async function openProposal(proposalId: string, actorId: string): Promise<{ ok: boolean; error?: string; proposal?: Proposal }> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { game: true } });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.authorId !== actorId && proposal.game.ownerId !== actorId) {
    return { ok: false, error: "Only the proposal author or the game owner can open voting." };
  }
  if (proposal.status !== "DRAFT") return { ok: false, error: `Proposal is already ${proposal.status}.` };

  const openedAt = new Date();
  const closesAt = computeClosesAt(openedAt, proposal.windowDays);
  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: "OPEN", openedAt, closesAt },
  });
  await notifyMembers(
    proposal.gameId,
    proposal.game.slug,
    proposal.id,
    "PROPOSAL_OPENED",
    `New proposal open for voting: "${proposal.title}"`,
  );
  return { ok: true, proposal: updated };
}

// ─────────────────────────── voting ───────────────────────────

export type VoteResult =
  | { ok: true; choice: "YES" | "NO"; tally: TallyResult }
  | { ok: false; error: string; reasons?: string[] };

/** Cast (or change) a vote, gated by the anti-brigading eligibility rule. Only while
 *  the proposal is OPEN and its window has not closed. */
export async function castVote(
  proposalId: string,
  userId: string,
  choice: "YES" | "NO",
  now: number = Date.now(),
): Promise<VoteResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.status !== "OPEN") return { ok: false, error: `Voting is not open (proposal is ${proposal.status}).` };
  if (windowState(now, proposal.openedAt, proposal.closesAt) !== "open") {
    return { ok: false, error: "The voting window has closed." };
  }

  const elig = await voterEligibility(userId, proposal.gameId, now);
  if (!elig.eligible) return { ok: false, error: "You are not eligible to vote on this proposal.", reasons: elig.reasons };

  await prisma.vote.upsert({
    where: { proposalId_userId: { proposalId, userId } },
    create: { proposalId, userId, choice },
    update: { choice },
  });
  return { ok: true, choice, tally: await proposalTally(proposal) };
}

// ─────────────────────────── finalize (window close → outcome) ───────────────────────────

/** Finalize a proposal whose window has closed: OPEN → PASSED | FAILED (or
 *  HELP_WANTED for a passed feature request). Idempotent — a non-OPEN or still-open
 *  proposal is returned unchanged. Lazily callable (on page view) or by a cron. */
export async function finalizeProposal(proposalId: string, now: number = Date.now()): Promise<Proposal | null> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { game: true } });
  if (!proposal) return null;
  if (proposal.status !== "OPEN") return proposal;
  if (windowState(now, proposal.openedAt, proposal.closesAt) !== "closed") return proposal;

  const counts = await countVotes(proposalId);
  const outcome = decideOutcome(now, proposal.openedAt, proposal.closesAt, counts, {
    thresholdPct: proposal.thresholdPct,
    quorum: proposal.quorum,
  });

  if (outcome === "passed") {
    // A passed FEATURE_REQUEST becomes a "help wanted" item (no auto-apply).
    const status = isAutoApplicable(proposal.type) ? "PASSED" : "HELP_WANTED";
    const updated = await prisma.proposal.update({
      where: { id: proposalId },
      data: { status, decidedAt: new Date(now) },
    });
    await notifyMembers(
      proposal.gameId,
      proposal.game.slug,
      proposal.id,
      "PROPOSAL_PASSED",
      isAutoApplicable(proposal.type)
        ? `Proposal PASSED — awaiting owner approval: "${proposal.title}"`
        : `Feature request PASSED — now help-wanted: "${proposal.title}"`,
    );
    return updated;
  }

  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: "FAILED", decidedAt: new Date(now) },
  });
  await notifyMembers(proposal.gameId, proposal.game.slug, proposal.id, "PROPOSAL_FAILED", `Proposal FAILED: "${proposal.title}"`);
  return updated;
}

// ─────────────────────────── owner approve → APP AUTO-COMMIT ───────────────────────────

export type ApplyResult =
  | { ok: true; commit: string; jobId: string; configChanges: ReturnType<typeof diffConfigs>; summary: string[] }
  | { ok: false; error: string; issues?: { code: string; message: string; where?: string }[]; critical?: boolean };

/**
 * Owner-approves a PASSED auto-applicable proposal and AUTO-COMMITS it to the
 * game's canonical repo via the GitHub APP INSTALLATION (never the owner's OAuth
 * token — locked decision). The SAME validateRemix gate runs before the commit. If
 * the installation token or the app-authored commit fails, we FAIL HARD with
 * critical:true — we do NOT fall back to OAuth.
 */
export async function approveAndCommit(proposalId: string, actorId: string): Promise<ApplyResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { game: true } });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  const game = proposal.game;
  if (game.ownerId !== actorId) return { ok: false, error: "Only the game owner can approve a passed proposal." };
  if (proposal.status !== "PASSED") return { ok: false, error: `Only a PASSED proposal can be applied (this is ${proposal.status}).` };
  if (!isAutoApplicable(proposal.type)) return { ok: false, error: "Feature requests are not auto-applied." };
  if (!game.installationId) {
    return { ok: false, critical: true, error: "No App installation on this repo — governance commits require the App (never OAuth)." };
  }
  const ref = parseRepoUrl(game.repoUrl);
  if (!ref) return { ok: false, error: `Unparseable repo URL: ${game.repoUrl}` };

  // 1. Mint the INSTALLATION ACCESS TOKEN (the governance commit credential).
  const tok = await getInstallationToken(game.installationId);
  if (!tok.ok || !tok.token) {
    // CORE failure — do NOT fall back to the owner's OAuth token (locked decision).
    return { ok: false, critical: true, error: `Could not mint a GitHub App installation token: ${tok.error}` };
  }

  // 2. Re-apply the proposal's edits against CURRENT main (tracks intervening
  //    pushes), then run THE GATE again. We read sources with the app token.
  const sources = await loadRemixSources(game, tok.token);
  const catalog = await getRemixCatalog();
  const applied = applyRemix(sources.scene, sources.config, proposal.edits as RemixEdits, catalog);
  if (applied.summary.length === 0) return { ok: false, error: "The proposal no longer changes anything against current main." };
  const issues = validateRemix(applied.scene, applied.config);
  if (issues.length > 0) {
    return { ok: false, error: "Applying this proposal to current main would produce an invalid game — not committed.", issues };
  }

  // 3. Commit as ONE readable commit, AUTHORED BY THE APP (installation token).
  const files = [
    { path: sources.scenePath, content: JSON.stringify(applied.scene, null, 2) + "\n" },
    { path: sources.configPath, content: JSON.stringify(applied.config, null, 2) + "\n" },
    ...applied.vendored,
  ];
  const counts = await countVotes(proposalId);
  const t = tally(counts, { thresholdPct: proposal.thresholdPct, quorum: proposal.quorum });
  const message =
    `Governance: apply passed proposal "${proposal.title}"\n\n` +
    applied.summary.map((s) => `- ${s}`).join("\n") +
    `\n\nProposal ${proposal.id} passed the community vote (${t.yes}/${t.total}, ${t.yesPct}%). ` +
    `Auto-committed by the GitCade governance app — no human touched git.`;

  const commit = await commitFiles(ref, game.branch, files, message, tok.token);
  if (!commit.ok || !commit.commit) {
    return { ok: false, critical: true, error: `App-authored commit failed: ${commit.error}` };
  }

  // 4. Enqueue the rebuild of canonical main.
  const { id: jobId } = await enqueueBuild({
    repoUrl: game.repoUrl,
    branch: game.branch,
    commit: commit.commit,
    gameSlug: game.slug,
  });
  await prisma.game.update({ where: { id: game.id }, data: { lastJobId: jobId, status: "BUILDING" } });
  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: "APPLIED", appliedCommit: commit.commit, appliedJobId: jobId, decidedAt: proposal.decidedAt ?? new Date() },
  });
  await notifyMembers(game.id, game.slug, proposal.id, "PROPOSAL_APPLIED", `Proposal APPLIED to main: "${proposal.title}"`);

  return { ok: true, commit: commit.commit, jobId, configChanges: diffConfigs(sources.config, applied.config), summary: applied.summary };
}

// ─────────────────────────── owner veto (the exit door) ───────────────────────────

export async function vetoProposal(
  proposalId: string,
  actorId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string; proposal?: Proposal }> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { game: true } });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (proposal.game.ownerId !== actorId) return { ok: false, error: "Only the game owner can veto." };
  if (proposal.status !== "PASSED") return { ok: false, error: `Only a PASSED proposal can be vetoed (this is ${proposal.status}).` };
  if (!reason.trim()) return { ok: false, error: "A public written reason is REQUIRED to veto." };

  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    // status → VETOED; vetoedAt being set records that it HAD passed (page shows
    // "PASSED + VETOED + reason" permanently).
    data: { status: "VETOED", vetoedAt: new Date(), vetoReason: reason.trim() },
  });
  await notifyMembers(
    proposal.gameId,
    proposal.game.slug,
    proposal.id,
    "PROPOSAL_VETOED",
    `Owner VETOED a passed proposal: "${proposal.title}". Fork-with-patch is available.`,
  );
  return { ok: true, proposal: updated };
}

// ─────────────────────────── the exit door: fork-with-patch ───────────────────────────

export type ForkWithPatchResult =
  | { ok: true; slug: string; forked: boolean; commit?: string; summary: string[] }
  | { ok: false; error: string; issues?: { code: string; message: string; where?: string }[] };

/**
 * "Democracy with an exit door" — fork the game and REPLAY the proposal's edits on
 * the fork in one click, so a vetoed (or any) auto-applicable proposal becomes an
 * immediately-playable fork. This acts as the USER (their OAuth token + fork), which
 * is exactly the Phase 6 remix machinery: ensure the user owns a fork, then commit
 * the same RemixEdits to it (validated, one readable commit, rebuild enqueued).
 */
export async function forkWithPatch(
  proposalId: string,
  userId: string,
  token: string,
  username: string,
): Promise<ForkWithPatchResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { game: true } });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (!isAutoApplicable(proposal.type)) {
    return { ok: false, error: "Fork-with-patch only applies to config-change / part-swap proposals." };
  }
  if (!proposal.edits) return { ok: false, error: "This proposal carries no edits to apply." };

  // 1. Ensure the user owns a fork of the proposal's game (idempotent).
  const ensured = await ensureRemixableFork(proposal.game.slug, userId, token, username);
  if (!ensured.ok) return { ok: false, error: ensured.error };

  // 2. Replay the proposal's edits onto the fork as one readable commit + rebuild.
  const fork = await prisma.game.findUnique({ where: { slug: ensured.slug } });
  if (!fork) return { ok: false, error: "Fork row vanished unexpectedly." };
  const committed = await commitRemix(fork, proposal.edits as RemixEdits, token);
  if (!committed.ok) {
    return { ok: false, error: committed.error ?? "Replaying the proposal on the fork failed.", issues: committed.issues };
  }
  return { ok: true, slug: ensured.slug, forked: ensured.forked, commit: committed.commit, summary: committed.summary };
}
