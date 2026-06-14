// GET /api/games/{slug}/lineage — the fork tree: parent chain + direct forks, each
// fork edge annotated with its headline diff (changed-files count + inline
// config.json value diffs). Computed live via GitHub; uses the signed-in user's
// token to lift rate limits when present. Always returns a tree (diffs degrade).
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { getLineage } from "@/lib/lineage";

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const token = (userId ? await getUserGitHubToken(userId) : null) ?? undefined;

  const lineage = await getLineage(params.slug, token);
  if (!lineage) return NextResponse.json({ ok: false, error: "Game not found." }, { status: 404 });
  return NextResponse.json({ ok: true, lineage });
}
