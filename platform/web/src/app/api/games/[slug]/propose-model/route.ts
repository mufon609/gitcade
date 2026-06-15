// GET /api/games/[slug]/propose-model — the point-and-click model (config sliders +
// sprite/movement swap options) for AUTHORING a proposal against a game's canonical
// main. Unlike /api/remix/[slug] this is NOT owner-gated: any signed-in member may
// PROPOSE a change (the change only lands if the community votes it through and the
// owner approves). Governance must be enabled (App installed) on the game.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadRemixModel } from "@/lib/remix-service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to propose." }, { status: 401 });

  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });
  if (!game.installationId) {
    return NextResponse.json({ ok: false, error: "Governance is not enabled for this game." }, { status: 403 });
  }

  const token = (await getUserGitHubToken(userId)) ?? undefined;
  try {
    const model = await loadRemixModel(game, token);
    return NextResponse.json({ ok: true, model, tier: game.tier });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 422 });
  }
}
