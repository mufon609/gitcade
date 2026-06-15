// POST /api/proposals/[id]/finalize — close-out a proposal whose voting window has
// elapsed (OPEN → PASSED | FAILED | HELP_WANTED). Idempotent and side-effect-safe to
// call from a page view or a cron; only acts when the window is actually closed.
import { NextRequest, NextResponse } from "next/server";
import { finalizeProposal } from "@/lib/governance-service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // No auth (idempotent, cron-safe) — limit by IP so it can't be hammered anonymously.
  const limited = await enforceRateLimit(req, RATE_LIMITS.proposalFinalize);
  if (limited) return limited;
  const proposal = await finalizeProposal(params.id);
  if (!proposal) return NextResponse.json({ ok: false, error: "Proposal not found." }, { status: 404 });
  return NextResponse.json({ ok: true, status: proposal.status });
}
