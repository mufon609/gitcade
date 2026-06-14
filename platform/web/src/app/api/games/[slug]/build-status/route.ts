// GET /api/games/{slug}/build-status — the publish UI polls this. It reconciles
// the Game from its latest Build row (THE VALIDATOR IS THE GATE) and returns the
// state plus, on failure, the worker's VERBATIM logs to surface in the UI.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshGameStatus } from "@/lib/publish";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) {
    return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });
  }
  const status = await refreshGameStatus(game.id);
  return NextResponse.json({
    ok: true,
    slug: game.slug,
    tier: game.tier,
    state: status.state,
    stage: status.stage ?? null,
    logs: status.logs ?? null,
    artifactPath: status.artifactPath ?? null,
    commit: status.commit ?? null,
  });
}
