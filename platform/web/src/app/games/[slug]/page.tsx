import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { refreshGameStatus } from "@/lib/publish";
import { listGameBranches } from "@/lib/branches";
import { GamePlayer } from "./GamePlayer";
import { ForkButton } from "./ForkButton";
import { ForkTree } from "./ForkTree";
import { JoinCommunity } from "./JoinCommunity";
import { MadeFrom } from "./MadeFrom";
import { RemixButton } from "./RemixButton";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: { slug: string } }) {
  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) notFound();

  // THE VALIDATOR IS THE GATE: reconcile from the latest Build before deciding
  // whether the game is playable.
  const status = await refreshGameStatus(game.id);
  const manifest = (game.manifest ?? {}) as Record<string, unknown>;
  const playCount = await prisma.playSession.count({ where: { gameId: game.id } });
  const memberCount = await prisma.communityMembership.count({ where: { gameId: game.id } });
  // Branch list for the switcher (DB-only — fast; the client refreshes + can add
  // repo branches on demand).
  const branches = await listGameBranches(game);
  const parent = game.parentGameId
    ? await prisma.game.findUnique({ where: { id: game.parentGameId }, select: { slug: true, name: true } })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-arcade-mute no-underline">
            ← Arcade
          </Link>
          <h1 className="text-2xl font-bold">{game.name}</h1>
          <p className="text-sm text-arcade-mute">{game.description}</p>
          {parent && (
            <p className="mt-1 text-xs text-arcade-mute">
              ⑂ forked from{" "}
              <Link href={`/games/${parent.slug}`} className="underline">
                {parent.name}
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`gc-chip ${game.tier === "ecosystem" ? "gc-tier-ecosystem" : "gc-tier-open"}`}>
            {game.tier}
          </span>
          <a className="gc-chip no-underline" href={game.repoUrl.replace(/\.git$/, "")} target="_blank" rel="noreferrer">
            source ↗
          </a>
          <ForkButton slug={game.slug} />
          {game.tier === "ecosystem" && <RemixButton slug={game.slug} />}
        </div>
      </div>

      {status.state === "LIVE" ? (
        <GamePlayer
          slug={game.slug}
          repoUrl={game.repoUrl}
          artifactBase={env.artifactBaseUrl}
          initialBranches={branches}
          initialBranch={game.branch}
        />
      ) : status.state === "BUILDING" ? (
        <div className="gc-panel p-8 text-center text-arcade-warn">
          ◌ This game is still building. <Link href="/publish">Watch publish status →</Link>
        </div>
      ) : (
        <div className="gc-panel border-arcade-bad/50 p-5">
          <h3 className="font-bold text-arcade-bad">This build failed the validator</h3>
          <p className="mt-1 text-sm text-arcade-mute">The worker’s logs, verbatim:</p>
          <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-arcade-edge bg-black/40 p-3 text-xs">
            {status.logs ?? "(no logs)"}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="gc-panel p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Stats</h3>
          <p className="mt-2 text-sm">▶ {playCount} play sessions</p>
          <p className="text-sm">★ {memberCount} community members</p>
        </div>
        <div className="gc-panel p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Manifest</h3>
          <dl className="mt-2 space-y-1 text-xs text-arcade-ink">
            <div>version: {String(manifest.version ?? "—")}</div>
            <div>sdk: {String(manifest.sdkVersion ?? "—")}</div>
            <div>library: {String(manifest.libraryVersion ?? "—")}</div>
          </dl>
        </div>
        <div className="gc-panel flex flex-col gap-2 p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Community</h3>
          <JoinCommunity slug={game.slug} />
          {game.tier === "ecosystem" && (
            <p className="text-xs text-arcade-mute">
              {game.installationId
                ? "✓ Governance app installed — proposals enabled in Phase 7."
                : "Governance app not installed — Phase 7 proposals disabled."}
            </p>
          )}
        </div>
      </div>

      {/* Phase 6: the catalog parts this ecosystem game is composed from. */}
      <MadeFrom
        game={{ id: game.id, repoUrl: game.repoUrl, branch: game.branch, manifest: game.manifest, tier: game.tier }}
      />

      {/* Phase 5: fork lineage. */}
      <ForkTree slug={game.slug} />
    </div>
  );
}
