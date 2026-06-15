import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartDetail } from "@/lib/marketplace";
import { gamesUsingPart } from "@/lib/usage";
import { PartPreview, type Preview } from "@/components/PartPreview";

export const dynamic = "force-dynamic";

export default async function PartDetailPage({ params }: { params: { partId: string } }) {
  const part = await getPartDetail(params.partId);
  if (!part) notFound();

  const usedIn = await gamesUsingPart(part.partId);
  const preview = (part.preview as Preview) ?? { kind: "none" };
  const params_ = part.paramsDoc ?? {};

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/parts" className="text-xs text-arcade-mute no-underline">
          ← Marketplace
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{part.partId}</h1>
          <span className="gc-chip">{part.kind}</span>
          <span className="gc-chip">{part.bucket}</span>
          <span className="gc-chip">{part.license}</span>
          <span className="gc-chip">v{part.version}</span>
          {part.source === "user" && (
            <span className="gc-chip border-arcade-accent text-arcade-accent">
              community · by {part.ownerLogin ?? "user"}
            </span>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-arcade-mute">{part.description}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="gc-panel flex flex-col gap-3 p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Live preview</h3>
          {/* Behavior previews need the full definition for the micro-scene; the
              client fetches it via /api/parts/[id]. Sprite/audio render directly. */}
          <PartPreview preview={preview} size={120} />
          <p className="text-xs text-arcade-mute">
            {preview.kind === "sprite"
              ? "Rendered from the served library asset."
              : preview.kind === "sfx" || preview.kind === "music"
                ? "Synthesized live by the library's Web Audio engine."
                : preview.kind === "behavior"
                  ? "Boots a tiny SDK micro-scene running this behavior."
                  : "No live preview for this part type."}
          </p>
        </div>

        <div className="gc-panel flex flex-col gap-2 p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Used in {usedIn.length} game{usedIn.length === 1 ? "" : "s"}</h3>
          {usedIn.length === 0 ? (
            <p className="text-xs text-arcade-mute">Not yet composed by any indexed game.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {usedIn.map((g) => (
                <li key={g!.slug}>
                  <Link href={`/games/${g!.slug}`} className="underline">
                    {g!.name}
                  </Link>{" "}
                  <span className="text-xs text-arcade-mute">({g!.tier})</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="gc-panel flex flex-col gap-2 p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Composes with</h3>
          {part.dependencies.length === 0 ? (
            <p className="text-xs text-arcade-mute">No declared dependencies.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {part.dependencies.map((d) => (
                <Link key={d} href={`/parts/${d}`} className="gc-chip no-underline">
                  {d}
                </Link>
              ))}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {part.tags.map((t) => (
              <span key={t} className="gc-chip">
                #{t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {Object.keys(params_).length > 0 && (
        <div className="gc-panel p-4">
          <h3 className="text-sm font-bold text-arcade-mute">Parameters</h3>
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-arcade-mute">
              <tr>
                <th className="py-1 pr-4">key</th>
                <th className="py-1 pr-4">type</th>
                <th className="py-1 pr-4">balance?</th>
                <th className="py-1">description</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(params_).map(([k, v]) => (
                <tr key={k} className="border-t border-arcade-edge/40">
                  <td className="py-1 pr-4 font-mono">{k}</td>
                  <td className="py-1 pr-4">{v.type}</td>
                  <td className="py-1 pr-4">{v.balance ? "$cfg" : "—"}</td>
                  <td className="py-1 text-arcade-mute">{v.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {part.source === "user" && part.sourceRepoUrl && (
        <div className="gc-panel p-4 text-xs text-arcade-mute">
          Published from{" "}
          <a className="underline" href={part.sourceRepoUrl.replace(/\.git$/, "")} target="_blank" rel="noreferrer">
            {part.sourceRepoUrl.replace(/\.git$/, "")}
          </a>
          {part.sourcePath ? ` · ${part.sourcePath}` : ""} · validated in the build sandbox.
        </div>
      )}
    </div>
  );
}
