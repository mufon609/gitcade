// GET /api/github/app/callback — GitHub redirects here after the owner installs
// the GitCade GitHub App on their game repo (the "Enable community governance"
// step). We capture `installation_id` and attach it to the Game identified by the
// `state` we passed in the install URL (the gameId). Installations are per-Game
// DATABASE rows (Locked Decision: governance commit credential) — not env.
//
// Phase 7 reads Game.installationId to auto-commit passed proposals via the App
// installation (never the owner's OAuth token). Until installed, proposals are
// disabled — surfaced in the publish + play UI.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const installationId = url.searchParams.get("installation_id");
  const gameId = url.searchParams.get("state"); // we set state=gameId in appInstallUrl

  const home = env.nextAuthUrl.replace(/\/+$/, "");

  if (installationId && gameId) {
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (game) {
      await prisma.game.update({
        where: { id: gameId },
        data: { installationId },
      });
      return NextResponse.redirect(`${home}/games/${game.slug}?governance=enabled`);
    }
  }
  // Couldn't reconcile — send them home with a notice rather than 500.
  return NextResponse.redirect(`${home}/?governance=error`);
}
