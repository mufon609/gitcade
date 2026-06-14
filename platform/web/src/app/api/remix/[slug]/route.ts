// GET /api/remix/[slug] — load the point-and-click remix model for a game the user
// OWNS (entities + sprite options, movement slots + compatible swaps, config
// sliders). Reads the fork's scene + config from its repo under the user's token.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadRemixModel } from "@/lib/remix-service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to remix." }, { status: 401 });

  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });
  if (game.ownerId !== userId) {
    return NextResponse.json({ ok: false, error: "You can only remix a game you own (fork it first)." }, { status: 403 });
  }

  const token = await getUserGitHubToken(userId);
  try {
    const model = await loadRemixModel(game, token ?? undefined);
    return NextResponse.json({ ok: true, model });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 422 });
  }
}
