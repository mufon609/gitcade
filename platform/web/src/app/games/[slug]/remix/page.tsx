import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, getUserGitHubToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { loadRemixModel } from "@/lib/remix-service";
import { RemixEditor } from "./RemixEditor";

export const dynamic = "force-dynamic";

export default async function RemixPage({ params }: { params: { slug: string } }) {
  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) notFound();

  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return (
      <div className="gc-panel p-8 text-center">
        <p className="text-sm text-arcade-mute">Sign in with GitHub to remix.</p>
        <Link href={`/games/${params.slug}`} className="mt-2 inline-block underline">
          ← back to the game
        </Link>
      </div>
    );
  }
  if (game.ownerId !== userId) {
    // Not the user's copy — bounce them through the fork-on-demand starter.
    redirect(`/games/${params.slug}`);
  }

  const token = await getUserGitHubToken(userId);
  let model;
  let loadError: string | null = null;
  try {
    model = await loadRemixModel(game, token ?? undefined);
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/games/${game.slug}`} className="text-xs text-arcade-mute no-underline">
          ← {game.name}
        </Link>
        <h1 className="text-2xl font-bold">🎨 Remix · {game.name}</h1>
        <p className="text-sm text-arcade-mute">
          Swap a sprite, swap a movement behavior, nudge the tunables — then commit one readable
          change to your fork. The validator is the gate: an invalid remix is blocked here, never
          built.
        </p>
      </div>

      {loadError ? (
        <div className="gc-panel border-arcade-bad/50 p-5 text-sm text-arcade-bad">
          Could not load this game for remixing: {loadError}
        </div>
      ) : (
        <RemixEditor slug={game.slug} branch={game.branch} model={model!} artifactBase={env.artifactBaseUrl} />
      )}
    </div>
  );
}
