// GET /api/games/{slug}/branches — the branch switcher's data. Returns the game's
// branches with build state (LIVE branches are playable; FAILED ones link to logs;
// UNBUILT repo branches can be built by the owner). `?repo=1` includes never-built
// repo branches via GitHub (slower); default is DB-only.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listGameBranches } from "@/lib/branches";

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const game = await prisma.game.findUnique({
    where: { slug: params.slug },
    select: { slug: true, repoUrl: true, branch: true },
  });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });

  const includeRepoBranches = new URL(req.url).searchParams.get("repo") === "1";
  let token: string | undefined;
  if (includeRepoBranches) {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    token = (userId ? await getUserGitHubToken(userId) : null) ?? undefined;
  }

  const branches = await listGameBranches(game, { includeRepoBranches, token });
  return NextResponse.json({ ok: true, slug: game.slug, branches });
}
