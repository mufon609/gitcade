// POST /api/publish — the browser publish entry. Authenticates the user, then
// calls the SHARED publishGame service (the same function the seed script uses).
// The validator (worker) is the gate; this route only enqueues + returns the
// gameId/slug for the client to poll.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { publishGame } from "@/lib/publish";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.publish, userId);
  if (limited) return limited;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Sign in with GitHub to publish." }, { status: 401 });
  }

  let body: { repoUrl?: string; branch?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.repoUrl) {
    return NextResponse.json({ ok: false, error: "repoUrl is required." }, { status: 400 });
  }

  // Use the user's stored GitHub token (raises rate limits; lets them publish a
  // repo they can see). Public repos work without it too.
  const token = (await getUserGitHubToken(userId)) ?? undefined;

  const result = await publishGame({
    repoUrl: body.repoUrl,
    branch: body.branch,
    ownerUserId: userId,
    token,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, stage: result.stage, errors: result.errors },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    gameId: result.gameId,
    slug: result.slug,
    tier: result.tier,
    jobId: result.jobId,
    deduped: result.deduped,
    reused: result.reused,
    gate: result.gate,
  });
}
