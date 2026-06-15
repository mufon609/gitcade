// POST /api/community/join — "Join community" button. Writes a
// CommunityMembership (idempotent). HARD REQUIREMENT of Phase 7 (voting is
// restricted to members). No other community features in Phase 4B.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.communityJoin, userId);
  if (limited) return limited;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Sign in to join a community." }, { status: 401 });
  }

  let body: { slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.slug) return NextResponse.json({ ok: false, error: "slug required." }, { status: 400 });

  const game = await prisma.game.findUnique({ where: { slug: body.slug }, select: { id: true } });
  if (!game) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });

  await prisma.communityMembership.upsert({
    where: { userId_gameId: { userId, gameId: game.id } },
    create: { userId, gameId: game.id },
    update: {},
  });
  return NextResponse.json({ ok: true, joined: true });
}

// GET — is the current user a member? (Used to render the button state.)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const slug = new URL(req.url).searchParams.get("slug");
  if (!userId || !slug) return NextResponse.json({ ok: true, member: false });
  const game = await prisma.game.findUnique({ where: { slug }, select: { id: true } });
  if (!game) return NextResponse.json({ ok: true, member: false });
  const m = await prisma.communityMembership.findUnique({
    where: { userId_gameId: { userId, gameId: game.id } },
  });
  return NextResponse.json({ ok: true, member: !!m });
}
