import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { NewProposalEditor } from "./NewProposalEditor";

export const dynamic = "force-dynamic";

export default async function NewProposalPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { bug?: string };
}) {
  const game = await prisma.game.findUnique({
    where: { slug: params.slug },
    select: { slug: true, name: true, installationId: true, tier: true },
  });
  if (!game) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`/games/${game.slug}#community`} className="text-xs text-arcade-mute no-underline">
          ← {game.name} · community
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{searchParams.bug ? "Report a bug" : "New proposal"}</h1>
        <p className="text-sm text-arcade-mute">{game.name}</p>
      </div>
      {!game.installationId ? (
        <p className="gc-panel p-4 text-sm text-arcade-warn">
          Governance is not enabled for this game (the GitCade App is not installed on its repo).
        </p>
      ) : (
        <NewProposalEditor slug={game.slug} tier={game.tier} startBug={!!searchParams.bug} />
      )}
    </div>
  );
}
