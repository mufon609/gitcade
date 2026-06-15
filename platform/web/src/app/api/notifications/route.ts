// GET /api/notifications — the signed-in user's in-app notifications (unread first,
// newest first) + the unread count for the nav bell.
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: true, notifications: [], unread: 0 });

  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    take: 30,
  });
  const unread = await prisma.notification.count({ where: { userId, readAt: null } });
  return NextResponse.json({
    ok: true,
    unread,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      gameSlug: n.gameSlug,
      proposalId: n.proposalId,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  });
}
