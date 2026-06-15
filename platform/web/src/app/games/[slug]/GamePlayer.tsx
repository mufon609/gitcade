"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PlayPane } from "@/components/PlayPane";
import { buildArtifactIndexUrl } from "@/lib/artifact-url";

interface BranchEntry {
  name: string;
  state: "LIVE" | "BUILDING" | "FAILED" | "UNBUILT";
  commit?: string | null;
  playable: boolean;
  primary: boolean;
}

/**
 * The single-game player with a BRANCH SWITCHER. Playable (LIVE) branches are
 * selectable and swap the iframe artifact (each branch is served at the FROZEN
 * {slug}/{branch} path). Branches with a failing/pending build are listed disabled.
 * Re-fetches the branch list so a branch that finishes building appears without a
 * reload.
 */
export function GamePlayer({
  slug,
  repoUrl,
  artifactBase,
  initialBranches,
  initialBranch,
}: {
  slug: string;
  repoUrl: string;
  artifactBase: string;
  initialBranches: BranchEntry[];
  initialBranch: string;
}) {
  const [branches, setBranches] = useState<BranchEntry[]>(initialBranches);
  const [selected, setSelected] = useState<string>(initialBranch);

  // Refresh branch states (a BUILDING branch may flip to LIVE).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/games/${slug}/branches`, { cache: "no-store" });
        const data = await res.json();
        if (!stop && data.ok) setBranches(data.branches as BranchEntry[]);
      } catch {
        /* transient */
      }
    };
    const id = setInterval(tick, 8000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [slug]);

  const playable = useMemo(() => branches.filter((b) => b.playable), [branches]);
  const others = useMemo(() => branches.filter((b) => !b.playable), [branches]);
  const current = branches.find((b) => b.name === selected);
  const repoBranchUrl = (branch: string) => `${repoUrl.replace(/\.git$/, "")}/tree/${branch}`;

  const indexUrl = buildArtifactIndexUrl(artifactBase, slug, selected);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-arcade-mute">branch</label>
        <select
          className="gc-input w-auto py-1"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Select branch to play"
        >
          {playable.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
              {b.primary ? "  (default)" : ""} — ● live
            </option>
          ))}
          {others.length > 0 && (
            <optgroup label="not playable">
              {others.map((b) => (
                <option key={b.name} value={b.name} disabled>
                  {b.name} — {b.state === "FAILED" ? "✕ build failed" : b.state === "BUILDING" ? "◌ building" : "· unbuilt"}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {playable.length >= 1 && (
          <Link
            href={`/compare?a=${encodeURIComponent(slug)}&ab=${encodeURIComponent(selected)}`}
            className="gc-chip no-underline hover:border-arcade-accent"
            title="Compare this branch/fork against another, side by side"
          >
            ⇄ compare
          </Link>
        )}

        {others.length > 0 && (
          <span className="text-xs text-arcade-mute">
            {others.map((b) => (
              <a key={b.name} href={repoBranchUrl(b.name)} target="_blank" rel="noreferrer" className="ml-2 underline">
                {b.name} ({b.state.toLowerCase()}) ↗
              </a>
            ))}
          </span>
        )}
      </div>

      {current?.playable ? (
        <PlayPane key={selected} slug={slug} branch={selected} indexUrl={indexUrl} />
      ) : (
        <div className="gc-panel p-6 text-center text-arcade-warn">
          This branch isn’t playable yet ({current?.state.toLowerCase() ?? "unknown"}). Pick a live branch above.
        </div>
      )}
    </div>
  );
}
