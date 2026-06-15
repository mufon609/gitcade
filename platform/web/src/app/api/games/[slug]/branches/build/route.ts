// POST /api/games/{slug}/branches/build — let the game owner kick off a build of a
// branch that exists on the repo but has no artifact yet (so it becomes selectable
// in the branch switcher / compare). Enqueue only — we never build. Owner-gated.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueBuild } from "@/lib/queue";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.branchBuild, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to build a branch." }, { status: 401 });

  const game = await prisma.game.findUnique({
    where: { slug: params.slug },
    select: { slug: true, repoUrl: true, ownerId: true },
  });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });
  if (game.ownerId !== userId) {
    return NextResponse.json({ ok: false, error: "Only the game owner can build a new branch." }, { status: 403 });
  }

  let body: { branch?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const branch = body.branch?.trim();
  if (!branch) return NextResponse.json({ ok: false, error: "branch is required." }, { status: 400 });

  const job = await enqueueBuild({ repoUrl: game.repoUrl, branch, gameSlug: game.slug });
  return NextResponse.json({ ok: true, jobId: job.id, deduped: job.deduped, branch });
}
