// POST /api/fork — the Fork button's entry point. Authenticates the user, reads
// their stored GitHub OAuth token (public_repo scope), and calls the SHARED
// forkGame service (the same function the fork-demo script uses — flow shared,
// never mocked). Returns the new fork's slug so the client can redirect + poll.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { forkGame } from "@/lib/fork";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const githubLogin = (session?.user as { githubLogin?: string | null } | undefined)?.githubLogin ?? undefined;
  const limited = await enforceRateLimit(req, RATE_LIMITS.fork, userId);
  if (limited) return limited;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Sign in with GitHub to fork." }, { status: 401 });
  }

  let body: { slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.slug) {
    return NextResponse.json({ ok: false, error: "slug is required." }, { status: 400 });
  }

  const token = await getUserGitHubToken(userId);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "No GitHub token on file — sign out and back in to grant repo access." },
      { status: 403 },
    );
  }

  const result = await forkGame({
    parentSlug: body.slug,
    userId,
    token,
    username: githubLogin ?? undefined,
  });

  if (!result.ok) {
    // 409-ish: GitHub-slow (ready) is retryable; the rest are 422.
    const status = result.stage === "ready" ? 503 : 422;
    return NextResponse.json({ ok: false, stage: result.stage, error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    slug: result.slug,
    parentSlug: result.parentSlug,
    timings: result.timings,
  });
}
