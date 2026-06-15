// POST /api/games/[slug]/proposals — create a governance proposal (DRAFT; optionally
// open it for voting in the same request). GET — list this game's proposals with
// live tallies for the Community tab refresh.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createProposal, openProposal, tallyProposals } from "@/lib/governance-service";
import type { ProposalType } from "@prisma/client";
import type { RemixEdits } from "@/lib/remix";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });
  const proposals = await prisma.proposal.findMany({
    where: { gameId: game.id },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true, githubLogin: true } } },
  });
  // Tally ALL proposals in ONE GROUP BY (collapses the per-proposal 2× vote.count
  // N+1; this endpoint is polled every 15s by the Community tab).
  const tallies = await tallyProposals(proposals);
  const withTally = proposals.map((p) => ({
    id: p.id,
    type: p.type,
    status: p.status,
    title: p.title,
    closesAt: p.closesAt,
    vetoedAt: p.vetoedAt,
    author: p.author.githubLogin ?? p.author.name,
    tally: tallies.get(p.id)!,
  }));
  return NextResponse.json({ ok: true, proposals: withTally });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.proposalCreate, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to propose." }, { status: 401 });

  let body: {
    type?: ProposalType;
    title?: string;
    body?: string;
    edits?: RemixEdits;
    windowDays?: number;
    quorum?: number;
    thresholdPct?: number;
    open?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.type) return NextResponse.json({ ok: false, error: "A proposal type is required." }, { status: 400 });

  const token = (await getUserGitHubToken(userId)) ?? undefined;
  const created = await createProposal({
    gameSlug: params.slug,
    authorId: userId,
    type: body.type,
    title: body.title ?? "",
    body: body.body,
    edits: body.edits,
    windowDays: body.windowDays,
    quorum: body.quorum,
    thresholdPct: body.thresholdPct,
    token,
  });
  if (!created.ok) return NextResponse.json(created, { status: 422 });

  let proposal = created.proposal;
  if (body.open) {
    const opened = await openProposal(proposal.id, userId);
    if (opened.ok && opened.proposal) proposal = opened.proposal;
  }
  return NextResponse.json({ ok: true, id: proposal.id, status: proposal.status });
}
