import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { refreshGameStatus } from "@/lib/publish";
import { artifactIndexUrl } from "@/lib/artifact";
import { GameFrame } from "./GameFrame";
import { JoinCommunity } from "./JoinCommunity";

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

  const indexUrl = artifactIndexUrl(game.slug, game.branch);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-arcade-mute no-underline">
            ← Arcade
          </Link>
          <h1 className="text-2xl font-bold">{game.name}</h1>
          <p className="text-sm text-arcade-mute">{game.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`gc-chip ${game.tier === "ecosystem" ? "gc-tier-ecosystem" : "gc-tier-open"}`}>
            {game.tier}
          </span>
          <a className="gc-chip no-underline" href={game.repoUrl} target="_blank" rel="noreferrer">
            source ↗
          </a>
        </div>
      </div>

      {status.state === "LIVE" ? (
        <GameFrame slug={game.slug} branch={game.branch} indexUrl={indexUrl} />
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

      {/* ── Phase 5/6 extension points (intentionally inert in 4B) ──
          - Fork button + branch switcher + fork tree mount here (Phase 5).
          - "Made from" catalog-parts panel mounts here (Phase 6). */}
    </div>
  );
}
