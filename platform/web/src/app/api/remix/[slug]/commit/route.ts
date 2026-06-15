// POST /api/remix/[slug]/commit { edits } — validate the remix, commit it to the
// user's fork as ONE readable commit, and enqueue a rebuild. The VALIDATOR GATE
// runs here (validateRemix) BEFORE committing — an invalid remix is rejected with
// readable issues, never built.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { commitRemix } from "@/lib/remix-service";
import type { RemixEdits } from "@/lib/remix";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.remixCommit, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to remix." }, { status: 401 });

  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });
  if (game.ownerId !== userId) {
    return NextResponse.json({ ok: false, error: "You can only remix a game you own." }, { status: 403 });
  }

  let edits: RemixEdits;
  try {
    edits = (await req.json()) as RemixEdits;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const token = await getUserGitHubToken(userId);
  if (!token) {
    return NextResponse.json({ ok: false, error: "No GitHub token on file." }, { status: 403 });
  }

  const result = await commitRemix(game, edits, token);
  if (!result.ok) {
    // Validation issues → 422 with the readable issue list (prevented BEFORE commit).
    return NextResponse.json(result, { status: 422 });
  }
  return NextResponse.json(result);
}
