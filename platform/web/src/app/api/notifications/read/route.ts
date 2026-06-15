// POST /api/notifications/read { id? } — mark one notification (by id) or ALL of the
// user's notifications as read.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const limited = await enforceRateLimit(req, RATE_LIMITS.notificationsRead, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in." }, { status: 401 });

  let id: string | undefined;
  try {
    id = ((await req.json()) as { id?: string }).id;
  } catch {
    /* mark all */
  }
  const now = new Date();
  if (id) {
    await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: now } });
  } else {
    await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: now } });
  }
  return NextResponse.json({ ok: true });
}
