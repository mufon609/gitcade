// POST /api/proposals/[id]/open — author/owner opens a DRAFT proposal for voting.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { openProposal } from "@/lib/governance-service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.proposalOpen, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });
  const res = await openProposal(params.id, userId);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
