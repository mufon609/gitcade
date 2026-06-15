// GET /api/proposals/[id]/tally — live tally + (for the signed-in user) their current
// vote and voting eligibility, so the proposal page can show the anti-brigading state
// without a full reload. Finalizes lazily if the window has closed.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { finalizeProposal, proposalTally, voterEligibility } from "@/lib/governance-service";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // Lazy finalize: a page poll is enough to close out an elapsed window.
  await finalizeProposal(params.id);
  const proposal = await prisma.proposal.findUnique({ where: { id: params.id } });
  if (!proposal) return NextResponse.json({ ok: false, error: "Proposal not found." }, { status: 404 });

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;

  let myVote: "YES" | "NO" | null = null;
  let eligibility: { eligible: boolean; reasons: string[] } | null = null;
  if (userId) {
    const v = await prisma.vote.findUnique({ where: { proposalId_userId: { proposalId: params.id, userId } } });
    myVote = (v?.choice as "YES" | "NO" | undefined) ?? null;
    const e = await voterEligibility(userId, proposal.gameId);
    eligibility = { eligible: e.eligible, reasons: e.reasons };
  }

  return NextResponse.json({
    ok: true,
    status: proposal.status,
    closesAt: proposal.closesAt,
    tally: await proposalTally(proposal),
    myVote,
    eligibility,
  });
}
