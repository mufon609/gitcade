// POST /api/proposals/[id]/vote { choice: "YES" | "NO" } — cast a vote. Gated by the
// trust-critical anti-brigading eligibility rule (member + account age > 7d +
// played/contributed). A blocked voter gets a 403 with the specific reasons.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { castVote } from "@/lib/governance-service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.vote, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to vote." }, { status: 401 });

  let choice: "YES" | "NO" = "YES";
  try {
    const body = (await req.json()) as { choice?: "YES" | "NO" };
    if (body.choice === "NO" || body.choice === "YES") choice = body.choice;
  } catch {
    /* default YES */
  }

  const res = await castVote(params.id, userId, choice);
  if (!res.ok) {
    // Eligibility failures carry reasons → 403 so the UI shows the anti-brigading rule.
    return NextResponse.json(res, { status: res.reasons ? 403 : 400 });
  }
  return NextResponse.json(res);
}
