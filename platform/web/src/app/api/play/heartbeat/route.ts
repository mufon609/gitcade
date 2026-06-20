// POST /api/play/heartbeat — the player heartbeat. Creates a PlaySession on first
// beat and updates its durationSec on subsequent beats. It records every play
// (driving the per-game play-count stat) and runs for anonymous players too
// (userId nullable).
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  // Anonymous players are allowed (PlaySession is an eligibility signal), so
  // throttle by IP — generous, since a beat fires only every ~10s per open pane.
  const limited = await enforceRateLimit(req, RATE_LIMITS.heartbeat);
  if (limited) return limited;

  let body: { slug?: string; branch?: string; playSessionId?: string; durationSec?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.slug) {
    return NextResponse.json({ ok: false, error: "slug required." }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { slug: body.slug }, select: { id: true } });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const branch = body.branch || "main";
  const durationSec = Math.max(0, Math.floor(body.durationSec ?? 0));

  // Update an existing session (validate it belongs to this game), else create.
  if (body.playSessionId) {
    const existing = await prisma.playSession.findUnique({ where: { id: body.playSessionId } });
    if (existing && existing.gameId === game.id) {
      await prisma.playSession.update({
        where: { id: existing.id },
        // Monotonic: never let a late/smaller beat shrink the recorded duration.
        data: { durationSec: Math.max(existing.durationSec, durationSec) },
      });
      return NextResponse.json({ ok: true, playSessionId: existing.id });
    }
  }

  const created = await prisma.playSession.create({
    data: { gameId: game.id, userId, branch, durationSec },
  });
  return NextResponse.json({ ok: true, playSessionId: created.id });
}
