// POST /api/proposals/[id]/veto { reason } — the GAME OWNER vetoes a PASSED proposal.
// A public written reason is REQUIRED. The proposal page then permanently shows
// PASSED + VETOED + reason, plus the prominent fork-with-patch button.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { vetoProposal } from "@/lib/governance-service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.proposalVeto, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });

  let reason = "";
  try {
    reason = String(((await req.json()) as { reason?: string }).reason ?? "");
  } catch {
    /* empty */
  }
  const res = await vetoProposal(params.id, userId, reason);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
