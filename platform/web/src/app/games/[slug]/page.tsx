import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { refreshGameStatus } from "@/lib/publish";
import { listGameBranches } from "@/lib/branches";
import { GamePlayer } from "./GamePlayer";
import { ForkButton } from "./ForkButton";
import { Versions } from "./Versions";
import { MadeFrom } from "./MadeFrom";
import { RemixButton } from "./RemixButton";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: { slug: string } }) {
  const game = await prisma.game.findUnique({ where: { slug: params.slug } });
  if (!game) notFound();

  const manifest = (game.manifest ?? {}) as Record<string, unknown>;
  // Machine-readable control hints from the persisted manifest snapshot (manifestSnapshot carries
  // them). Defensively narrowed — older snapshots predate the field (→ []) and a malformed entry is
  // simply dropped rather than thrown on.
  const controls = Array.isArray(manifest.controls)
    ? (manifest.controls as unknown[]).filter(
        (c): c is { input: string; action: string } =>
          !!c &&
          typeof c === "object" &&
          typeof (c as { input?: unknown }).input === "string" &&
          typeof (c as { action?: unknown }).action === "string",
      )
    : [];
  // These reads are independent — run them concurrently. THE VALIDATOR IS THE GATE:
  // refreshGameStatus reconciles from the latest Build before we decide whether the
  // game is playable. Branch list is DB-only (fast); the client refreshes + can add
  // repo branches on demand.
  const [status, playCount, branches, parent] = await Promise.all([
    refreshGameStatus(game.id),
    prisma.playSession.count({ where: { gameId: game.id } }),
    listGameBranches(game),
    game.parentGameId
      ? prisma.game.findUnique({ where: { id: game.parentGameId }, select: { slug: true, name: true } })
      : Promise.resolve(null),
  ]);

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

      {controls.length > 0 && (
        <div className="gc-panel p-4">
          <h2 className="text-sm font-bold text-arcade-mute">Controls</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {controls.map((c, i) => (
              <span key={i} className="gc-chip">
                <span className="font-bold text-arcade-ink">{c.input}</span>
                <span className="text-arcade-mute"> · {c.action}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="gc-panel p-4">
          <h2 className="text-sm font-bold text-arcade-mute">Stats</h2>
          <p className="mt-2 text-sm">▶ {playCount} play sessions</p>
        </div>
        <div className="gc-panel p-4">
          <h2 className="text-sm font-bold text-arcade-mute">Manifest</h2>
          <dl className="mt-2 space-y-1 text-xs text-arcade-ink">
            <div className="flex gap-1">
              <dt className="text-arcade-mute">version:</dt>
              <dd>{String(manifest.version ?? "—")}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-arcade-mute">sdk:</dt>
              <dd>{String(manifest.sdkVersion ?? "—")}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-arcade-mute">library:</dt>
              <dd>{String(manifest.libraryVersion ?? "—")}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* The catalog parts this ecosystem game is composed from. */}
      <MadeFrom
        game={{ id: game.id, repoUrl: game.repoUrl, branch: game.branch, manifest: game.manifest, tier: game.tier }}
      />

      {/* Lineage, re-presented: current version + a forks-as-versions dropdown. */}
      <Versions slug={game.slug} />
    </div>
  );
}
