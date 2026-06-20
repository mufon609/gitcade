"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ConfigDiff } from "@/components/ConfigDiff";
import type { ConfigChange } from "@/lib/configdiff";

// THE VERSIONS HUB (lineage, re-presented). The game's OWN/current version
// is the one hosted and played up top (see GamePlayer). This component is the
// "Versions" selector: the current version featured here, plus a dropdown of THIS
// game's forks, newest first. Forks are reference/replay links to their GitHub
// repos — they are NOT hosted-playable; only the current version is. The lineage
// data + headline diffs are reused verbatim from /api/games/{slug}/lineage.

interface ForkDiff {
  changedFiles: number;
  onlyConfig: boolean;
  configChanges?: ConfigChange[];
  error?: string;
}
interface Node {
  slug: string;
  name: string;
  tier: string;
  status: string;
  repoUrl: string;
  diffVsParent?: ForkDiff | null;
}
interface Lineage {
  current: Node;
  ancestors: Node[];
  forks: Node[];
}

const repoHref = (repoUrl: string) => repoUrl.replace(/\.git$/, "");

function DiffSummary({ diff }: { diff?: ForkDiff | null }) {
  if (!diff) return null;
  if (diff.error) return <span className="text-xs text-arcade-mute">diff unavailable</span>;
  if (diff.changedFiles === 0)
    return <span className="text-xs text-arcade-mute">identical to this version</span>;
  return (
    <div className="mt-1 flex flex-col gap-1">
      <span className="text-xs text-arcade-mute">
        {diff.changedFiles} changed file{diff.changedFiles === 1 ? "" : "s"}
        {diff.onlyConfig ? " · config only" : ""}
      </span>
      {diff.configChanges && diff.configChanges.length > 0 && <ConfigDiff changes={diff.configChanges} compact />}
    </div>
  );
}

/** One fork row in the dropdown: links to its GitHub repo (reference / fork-to-replay). */
function ForkEntry({ node }: { node: Node }) {
  return (
    <div className="gc-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <a
            href={repoHref(node.repoUrl)}
            target="_blank"
            rel="noreferrer"
            className="font-bold no-underline hover:text-arcade-accent"
            title="Open this fork's GitHub repo"
          >
            {node.name} ↗
          </a>
          <span className={`gc-chip ${node.tier === "ecosystem" ? "gc-tier-ecosystem" : "gc-tier-open"}`}>
            {node.tier}
          </span>
          <span className="text-xs text-arcade-mute">{node.status.toLowerCase()}</span>
        </div>
        <Link
          href={`/compare?a=${encodeURIComponent(node.slug)}&b=${encodeURIComponent("__parent__")}`}
          className="hidden text-xs text-arcade-mute underline sm:inline"
          title="Compare this fork with its parent"
        >
          compare ⇄
        </Link>
      </div>
      <DiffSummary diff={node.diffVsParent} />
    </div>
  );
}

/** The Versions selector: current version featured (hosted/playable above), forks
 *  listed newest-first in a dropdown as GitHub links. */
export function Versions({ slug }: { slug: string }) {
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stop = false;
    fetch(`/api/games/${slug}/lineage`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!stop && d.ok) setLineage(d.lineage as Lineage);
      })
      .catch(() => {})
      .finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [slug]);

  if (loading) return <p className="text-sm text-arcade-mute">Loading versions…</p>;
  if (!lineage) return null;

  const { current, ancestors, forks } = lineage;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-arcade-mute">Versions</h2>

      {ancestors.length > 0 && (
        <p className="text-xs text-arcade-mute">
          ⑂ forked from{" "}
          {ancestors.map((a, i) => (
            <span key={a.slug}>
              {i > 0 && " › "}
              <Link href={`/games/${a.slug}`} className="underline">
                {a.name}
              </Link>
            </span>
          ))}
        </p>
      )}

      {/* Current version — the one hosted and playable above. */}
      <div className="gc-panel border-arcade-accent p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-arcade-accent">{current.name}</span>
            <span className={`gc-chip ${current.tier === "ecosystem" ? "gc-tier-ecosystem" : "gc-tier-open"}`}>
              {current.tier}
            </span>
          </div>
          <span className="text-xs text-arcade-good">● current — playable above</span>
        </div>
        <DiffSummary diff={current.diffVsParent} />
      </div>

      {/* Forks dropdown — newest first, each a GitHub link (reference, not hosted). */}
      {forks.length === 0 ? (
        <p className="text-sm text-arcade-mute">No forks yet. Fork it to start a new version.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="gc-panel flex items-center justify-between gap-2 p-3 text-left hover:border-arcade-accent"
          >
            <span className="text-sm font-bold">
              {forks.length} fork{forks.length === 1 ? "" : "s"} — other versions
            </span>
            <span className="text-arcade-mute">{open ? "▴" : "▾"}</span>
          </button>
          {open && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-arcade-mute">
                Forks open on GitHub — fork or clone to play your own copy. Only the current version above is
                hosted and playable here.
              </p>
              {forks.map((f) => (
                <ForkEntry key={f.slug} node={f} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
