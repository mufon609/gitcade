import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { HomeGrid } from "@/components/HomeGrid";
import type { GameCardData } from "@/components/GameCard";

// Home: the arcade grid. Server component reads Games directly. Newest first,
// live games are what players want — but we show building/failed with a badge too
// so an owner can watch their publish land.
//
// ONE CARD PER ROOT GAME: forks (parentGameId != null) never surface here — they
// live under their parent's "Versions" dropdown on the game page. Search/filter
// below therefore operate over roots only.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const games = await prisma.game.findMany({
    where: { parentGameId: null },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      slug: true,
      name: true,
      description: true,
      tier: true,
      status: true,
      tags: true,
    },
  });

  const data: GameCardData[] = games.map((g) => ({
    slug: g.slug,
    name: g.name,
    description: g.description,
    tier: g.tier,
    status: g.status,
    tags: g.tags,
  }));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">The GitCade Arcade</h1>
        <p className="max-w-2xl text-arcade-mute">
          Open-source, AI-built browser games — published from a GitHub repo, validated by the build
          pipeline, and played in a sandboxed iframe. Fork or remix any game to make it your own.
        </p>
        <div>
          <Link href="/publish" className="gc-btn gc-btn-primary mt-2 no-underline">
            Publish a game →
          </Link>
        </div>
      </section>

      {data.length === 0 ? (
        <div className="gc-panel p-8 text-center text-arcade-mute">
          No games published yet. Run the seed script or{" "}
          <Link href="/publish">publish one</Link>.
        </div>
      ) : (
        <HomeGrid games={data} />
      )}
    </div>
  );
}
