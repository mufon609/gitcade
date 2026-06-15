// Per-game bug tracker. POST creates a report tied to the build/commit it was
// observed on; GET lists them for the Community tab.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });
  const bugs = await prisma.bugReport.findMany({
    where: { gameId: game.id },
    orderBy: { createdAt: "desc" },
    include: { reporter: { select: { name: true, githubLogin: true } } },
  });
  return NextResponse.json({
    ok: true,
    bugs: bugs.map((b) => ({
      id: b.id,
      title: b.title,
      body: b.body,
      status: b.status,
      commit: b.commit,
      proposalId: b.proposalId,
      reporter: b.reporter.githubLogin ?? b.reporter.name,
      createdAt: b.createdAt,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to report a bug." }, { status: 401 });

  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });

  let body: { title?: string; body?: string; commit?: string; buildId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.title?.trim() || !body.body?.trim()) {
    return NextResponse.json({ ok: false, error: "A title and description are required." }, { status: 422 });
  }

  // Default the observed-on commit to the game's last successful build commit.
  let commit = body.commit ?? null;
  if (!commit && game.lastJobId) {
    const build = await prisma.build.findUnique({ where: { jobId: game.lastJobId }, select: { commit: true } });
    commit = build?.commit ?? null;
  }

  const bug = await prisma.bugReport.create({
    data: {
      gameId: game.id,
      reporterId: userId,
      title: body.title.trim(),
      body: body.body.trim(),
      commit,
      buildId: body.buildId ?? game.lastJobId ?? null,
    },
  });
  return NextResponse.json({ ok: true, id: bug.id });
}
