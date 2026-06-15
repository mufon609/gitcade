// POST /api/proposals/[id]/fork-with-patch — the EXIT DOOR. Fork the game and replay
// the proposal's edits onto the fork in one click (acts as the USER + their OAuth
// token + fork, reusing the Phase 6 remix machinery). Works for config-change /
// part-swap; the result is an immediately-playable fork.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { forkWithPatch } from "@/lib/governance-service";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const username = (session?.user as { githubLogin?: string | null } | undefined)?.githubLogin;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to fork." }, { status: 401 });

  const token = await getUserGitHubToken(userId);
  if (!token) return NextResponse.json({ ok: false, error: "No GitHub token on file." }, { status: 403 });

  const res = await forkWithPatch(params.id, userId, token, username ?? "");
  return NextResponse.json(res, { status: res.ok ? 200 : 422 });
}
