"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ConfigDiff } from "@/components/ConfigDiff";
import type { ConfigChange } from "@/lib/configdiff";

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
  diffVsParent?: ForkDiff | null;
}
interface Lineage {
  current: Node;
  ancestors: Node[];
  forks: Node[];
}

function DiffSummary({ diff, here }: { diff?: ForkDiff | null; here?: boolean }) {
  if (!diff) return null;
  if (diff.error) return <span className="text-xs text-arcade-mute">diff unavailable</span>;
  if (diff.changedFiles === 0) return <span className="text-xs text-arcade-mute">identical to {here ? "parent" : "this game"}</span>;
  return (
    <div className="mt-1 flex flex-col gap-1">
      <span className="text-xs text-arcade-mute">
        {diff.changedFiles} changed file{diff.changedFiles === 1 ? "" : "s"}
        {diff.onlyConfig ? " · config only" : ""}
      </span>
      {diff.configChanges && diff.configChanges.length > 0 && (
        <ConfigDiff changes={diff.configChanges} compact />
      )}
    </div>
  );
}

function NodeRow({ node, kind }: { node: Node; kind: "ancestor" | "current" | "fork" }) {
  const isCurrent = kind === "current";
  return (
    <div
      className={`gc-panel p-3 ${isCurrent ? "border-arcade-accent" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isCurrent ? (
            <span className="font-bold text-arcade-accent">{node.name}</span>
          ) : (
            <Link href={`/games/${node.slug}`} className="font-bold no-underline hover:text-arcade-accent">
              {node.name}
            </Link>
          )}
          <span className={`gc-chip ${node.tier === "ecosystem" ? "gc-tier-ecosystem" : "gc-tier-open"}`}>
            {node.tier}
          </span>
          <span className="text-xs text-arcade-mute">{node.status.toLowerCase()}</span>
        </div>
        {kind === "fork" && (
          <Link
            href={`/compare?a=${encodeURIComponent(node.slug)}&b=${encodeURIComponent("__parent__")}`}
            className="hidden text-xs text-arcade-mute underline sm:inline"
            title="Compare this fork with its parent"
          >
            compare ⇄
          </Link>
        )}
      </div>
      <DiffSummary diff={node.diffVsParent} here={kind === "current"} />
    </div>
  );
}

/** The fork tree: parent chain upward, this game, and its direct forks downward —
 *  each fork annotated with its headline diff (and inline config diffs). */
export function ForkTree({ slug }: { slug: string }) {
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <p className="text-sm text-arcade-mute">Loading lineage…</p>;
  if (!lineage) return null;

  const hasLineage = lineage.ancestors.length > 0 || lineage.forks.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-arcade-mute">Fork tree</h2>

      {!hasLineage && (
        <p className="text-sm text-arcade-mute">
          No forks yet, and this is an original game. Fork it to start a lineage.
        </p>
      )}

      {lineage.ancestors.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-arcade-mute">▲ parent lineage</span>
          {lineage.ancestors.map((a) => (
            <NodeRow key={a.slug} node={a} kind="ancestor" />
          ))}
          <div className="ml-3 text-arcade-mute">│</div>
        </div>
      )}

      <NodeRow node={lineage.current} kind="current" />

      {lineage.forks.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="ml-3 text-arcade-mute">│</div>
          <span className="text-xs uppercase tracking-wide text-arcade-mute">▼ forks of this game</span>
          {lineage.forks.map((f) => (
            <NodeRow key={f.slug} node={f} kind="fork" />
          ))}
        </div>
      )}
    </div>
  );
}
