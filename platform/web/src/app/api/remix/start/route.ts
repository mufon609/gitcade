// POST /api/remix/start { slug } — entry point for Remix mode. Ensures the user has
// an OWN copy of the game to edit (fork-on-demand via the shared forkGame if they
// don't yet own it), then returns the slug to open Remix on.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureRemixableFork } from "@/lib/remix-service";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  let username = (session?.user as { githubLogin?: string | null } | undefined)?.githubLogin ?? "";
  const limited = await enforceRateLimit(req, RATE_LIMITS.remixStart, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in with GitHub to remix." }, { status: 401 });

  let body: { slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.slug) return NextResponse.json({ ok: false, error: "slug is required." }, { status: 400 });

  const token = await getUserGitHubToken(userId);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "No GitHub token on file — sign out and back in to grant repo access." },
      { status: 403 },
    );
  }
  if (!username) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { githubLogin: true } });
    username = u?.githubLogin ?? "";
  }

  const result = await ensureRemixableFork(body.slug, userId, token, username);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, slug: result.slug, forked: result.forked });
}
