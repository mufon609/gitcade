import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { finalizeProposal, proposalTally, voterEligibility } from "@/lib/governance-service";
import { ProposalView } from "./ProposalView";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: { slug: string; id: string } }) {
  // Lazy finalize on view so an elapsed window resolves without a cron in dev.
  await finalizeProposal(params.id);

  const proposal = await prisma.proposal.findUnique({
    where: { id: params.id },
    include: { game: true, author: { select: { name: true, githubLogin: true } } },
  });
  if (!proposal || proposal.game.slug !== params.slug) notFound();

  const session = await getServerSession(authOptions);
  const viewerId = (session?.user as { id?: string } | undefined)?.id;
  const isOwner = !!viewerId && viewerId === proposal.game.ownerId;
  const isAuthor = !!viewerId && viewerId === proposal.authorId;

  const tally = await proposalTally(proposal);
  const myVote = viewerId
    ? (await prisma.vote.findUnique({ where: { proposalId_userId: { proposalId: proposal.id, userId: viewerId } } }))?.choice ?? null
    : null;
  const elig = viewerId ? await voterEligibility(viewerId, proposal.gameId) : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/games/${proposal.game.slug}#community`} className="text-xs text-arcade-mute no-underline">
          ← {proposal.game.name} · community
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{proposal.title}</h1>
        <p className="text-xs text-arcade-mute">
          proposed by {proposal.author.githubLogin ?? proposal.author.name} ·{" "}
          {proposal.type.toLowerCase().replace("_", " ")}
        </p>
      </div>

      <ProposalView
        slug={proposal.game.slug}
        proposal={{
          id: proposal.id,
          type: proposal.type,
          status: proposal.status,
          body: proposal.body,
          baseConfig: proposal.baseConfig,
          headConfig: proposal.headConfig,
          changeSummary: proposal.changeSummary,
          thresholdPct: proposal.thresholdPct,
          quorum: proposal.quorum,
          windowDays: proposal.windowDays,
          closesAt: proposal.closesAt ? proposal.closesAt.toISOString() : null,
          vetoedAt: proposal.vetoedAt ? proposal.vetoedAt.toISOString() : null,
          vetoReason: proposal.vetoReason,
          appliedCommit: proposal.appliedCommit,
          repoUrl: proposal.game.repoUrl,
        }}
        viewer={{ signedIn: !!viewerId, isOwner, isAuthor }}
        initialTally={tally}
        initialMyVote={myVote}
        initialEligibility={elig ? { eligible: elig.eligible, reasons: elig.reasons } : null}
      />
    </div>
  );
}
