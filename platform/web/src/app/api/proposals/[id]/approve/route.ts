// POST /api/proposals/[id]/approve — the GAME OWNER approves a PASSED auto-applicable
// proposal. This AUTO-COMMITS the diff to the canonical repo via the GitHub APP
// INSTALLATION (never the owner's OAuth token — locked decision) and enqueues a
// rebuild. A failure to mint the installation token or commit is CRITICAL — we never
// fall back to OAuth.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { approveAndCommit } from "@/lib/governance-service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.proposalApprove, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });

  const res = await approveAndCommit(params.id, userId);
  if (!res.ok) {
    // 502 for a critical credential/commit failure (it's an upstream-facing fault),
    // 422 for a validation/state rejection.
    return NextResponse.json(res, { status: res.critical ? 502 : 422 });
  }
  return NextResponse.json(res);
}
