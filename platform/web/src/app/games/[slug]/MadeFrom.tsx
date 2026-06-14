import Link from "next/link";
import { execSync } from "node:child_process";
import { getMadeFrom, indexGameParts } from "@/lib/usage";

/** Read a GitHub token from the gh CLI (server-side) to raise the rate limit when
 *  lazily indexing. Anonymous still works for public seed repos (60 req/hr). */
function ghToken(): string | undefined {
  try {
    return execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The "Made from" panel (Phase 6): the catalog parts an ecosystem game composes,
 * parsed from its scene JSON's `partId@version` provenance refs and resolved
 * against the catalog. Reads the indexed GamePart mirror; if the game has never
 * been indexed, indexes it lazily (cached thereafter). Each part links to its
 * marketplace page; the part page links back ("used in N games").
 */
export async function MadeFrom({
  game,
}: {
  game: { id: string; repoUrl: string; branch: string; manifest: unknown; tier: string };
}) {
  if (game.tier !== "ecosystem") return null;

  let parts = await getMadeFrom(game.id);
  if (parts.length === 0) {
    try {
      await indexGameParts(game, ghToken());
      parts = await getMadeFrom(game.id);
    } catch {
      /* leave empty — degrade gracefully */
    }
  }

  if (parts.length === 0) return null;

  return (
    <div className="gc-panel p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-arcade-mute">
          🧩 Made from {parts.length} catalog part{parts.length === 1 ? "" : "s"}
        </h3>
        <Link href="/parts" className="text-xs text-arcade-mute no-underline hover:text-arcade-ink">
          browse marketplace →
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {parts.map((p) => {
          const inner = (
            <>
              <span className="font-mono">{p.id}</span>
              <span className="text-arcade-edge">@{p.version}</span>
              {p.count > 1 && <span className="ml-1 text-arcade-mute">×{p.count}</span>}
            </>
          );
          return p.partRef ? (
            <Link
              key={`${p.id}@${p.version}`}
              href={`/parts/${p.id}`}
              className="gc-chip no-underline hover:border-arcade-accent hover:text-arcade-accent"
              title={p.description ?? p.id}
            >
              {inner}
            </Link>
          ) : (
            <span
              key={`${p.id}@${p.version}`}
              className="gc-chip opacity-60"
              title="Not resolved in the current catalog mirror"
            >
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}
