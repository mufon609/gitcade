// POST /api/bugs/[id]/convert — the GAME OWNER converts a bug report into a
// FEATURE_REQUEST proposal (a draft the owner then opens for voting). Links the bug
// to the proposal and marks it CONVERTED.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createProposal } from "@/lib/governance-service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.bugConvert, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });

  const bug = await prisma.bugReport.findUnique({ where: { id: params.id }, include: { game: true } });
  if (!bug) return NextResponse.json({ ok: false, error: "Bug not found." }, { status: 404 });
  if (bug.game.ownerId !== userId) {
    return NextResponse.json({ ok: false, error: "Only the game owner can convert a bug into a proposal." }, { status: 403 });
  }

  const created = await createProposal({
    gameSlug: bug.game.slug,
    authorId: userId,
    type: "FEATURE_REQUEST",
    title: `Fix: ${bug.title}`,
    body: `Converted from bug report.\n\nObserved on commit: ${bug.commit ?? "(unknown)"}\n\n${bug.body}\n\nAcceptance: the reported behaviour no longer occurs.`,
  });
  if (!created.ok) return NextResponse.json(created, { status: 422 });

  await prisma.bugReport.update({ where: { id: bug.id }, data: { status: "CONVERTED", proposalId: created.proposal.id } });
  return NextResponse.json({ ok: true, proposalId: created.proposal.id });
}
