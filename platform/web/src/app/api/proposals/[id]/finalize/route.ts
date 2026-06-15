// POST /api/proposals/[id]/finalize — close-out a proposal whose voting window has
// elapsed (OPEN → PASSED | FAILED | HELP_WANTED). Idempotent and side-effect-safe to
// call from a page view or a cron; only acts when the window is actually closed.
import { NextRequest, NextResponse } from "next/server";
import { finalizeProposal } from "@/lib/governance-service";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const proposal = await finalizeProposal(params.id);
  if (!proposal) return NextResponse.json({ ok: false, error: "Proposal not found." }, { status: 404 });
  return NextResponse.json({ ok: true, status: proposal.status });
}
